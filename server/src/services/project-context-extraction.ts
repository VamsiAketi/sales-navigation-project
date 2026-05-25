import { and, asc, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { assets, projectContextFiles } from "@paperclipai/db";
import type { StorageService } from "../storage/types.js";
import { logger } from "../middleware/logger.js";
import { HttpError } from "../errors.js";
import { projectContextFileService } from "./project-context-files.js";
import { projectContextService } from "./project-context.js";
import { projectContextSyncService } from "./project-context-sync.js";

const PROJECT_DOC_MAX_BYTES = Number(process.env.PAPERCLIP_PROJECT_DOC_MAX_BYTES ?? 50 * 1024 * 1024);
const EXTRACTION_BATCH_SIZE = Math.max(1, Number(process.env.PAPERCLIP_CONTEXT_EXTRACTION_BATCH_SIZE ?? 5));
const DOC_CHUNK_SIZE_BYTES = Math.max(16 * 1024, Number(process.env.PAPERCLIP_CONTEXT_DOC_CHUNK_BYTES ?? 1024 * 1024));
const DOC_CHUNK_OVERLAP_BYTES = Math.max(1024, Number(process.env.PAPERCLIP_CONTEXT_DOC_CHUNK_OVERLAP_BYTES ?? 16 * 1024));

type FileRow = typeof projectContextFiles.$inferSelect;

function normalizeContentType(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function inferExtension(filename: string | null | undefined): string {
  const raw = (filename ?? "").trim().toLowerCase();
  const idx = raw.lastIndexOf(".");
  return idx === -1 ? "" : raw.slice(idx);
}

function isTextLikeContent(contentType: string, extension: string): boolean {
  if (contentType.startsWith("text/")) return true;
  if (contentType === "application/json") return true;
  if (contentType === "application/xml") return true;
  if (contentType === "application/yaml") return true;
  if (contentType === "application/x-yaml") return true;
  return [".md", ".markdown", ".txt", ".csv", ".json", ".yaml", ".yml", ".html", ".xml"].includes(extension);
}

function isPdfContent(contentType: string, extension: string): boolean {
  return contentType === "application/pdf" || extension === ".pdf";
}

function isDocxContent(contentType: string, extension: string): boolean {
  return (
    contentType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    || extension === ".docx"
  );
}

function isImageContent(contentType: string, extension: string): boolean {
  return contentType.startsWith("image/") || [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"].includes(extension);
}

async function readStreamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function chunkText(input: string): { chunkCount: number; chunkBytes: number; overlapBytes: number } {
  if (!input) {
    return { chunkCount: 0, chunkBytes: DOC_CHUNK_SIZE_BYTES, overlapBytes: DOC_CHUNK_OVERLAP_BYTES };
  }
  const bytes = Buffer.byteLength(input, "utf8");
  if (bytes <= DOC_CHUNK_SIZE_BYTES) {
    return { chunkCount: 1, chunkBytes: DOC_CHUNK_SIZE_BYTES, overlapBytes: DOC_CHUNK_OVERLAP_BYTES };
  }
  const effectiveWindow = Math.max(1, DOC_CHUNK_SIZE_BYTES - DOC_CHUNK_OVERLAP_BYTES);
  const chunkCount = Math.ceil((bytes - DOC_CHUNK_SIZE_BYTES) / effectiveWindow) + 1;
  return { chunkCount, chunkBytes: DOC_CHUNK_SIZE_BYTES, overlapBytes: DOC_CHUNK_OVERLAP_BYTES };
}

async function extractTextFromBuffer(input: {
  contentType: string;
  originalFilename: string | null;
  buffer: Buffer;
}): Promise<
  | { status: "complete"; extractedText: string; details: Record<string, unknown> }
  | { status: "skipped"; extractionError: string; details: Record<string, unknown> }
> {
  const contentType = normalizeContentType(input.contentType);
  const extension = inferExtension(input.originalFilename);

  if (isTextLikeContent(contentType, extension)) {
    const extractedText = input.buffer.toString("utf8");
    const chunk = chunkText(extractedText);
    return {
      status: "complete",
      extractedText,
      details: {
        strategy: "inline_text",
        extractedBytes: Buffer.byteLength(extractedText, "utf8"),
        ...chunk,
      },
    };
  }

  if (isPdfContent(contentType, extension)) {
    const mod = await import("pdf-parse");
    const parser = new mod.PDFParse({ data: input.buffer });
    try {
      const parsed = await parser.getText();
      const extractedText = (parsed.text ?? "").trim();
      const chunk = chunkText(extractedText);
      return {
        status: "complete",
        extractedText,
        details: {
          strategy: "pdf-parse",
          pages: parsed.pages?.length ?? null,
          extractedBytes: Buffer.byteLength(extractedText, "utf8"),
          ...chunk,
        },
      };
    } finally {
      await parser.destroy();
    }
  }

  if (isDocxContent(contentType, extension)) {
    const mammoth = await import("mammoth");
    const parsed = await mammoth.extractRawText({ buffer: input.buffer });
    const extractedText = (parsed.value ?? "").trim();
    const chunk = chunkText(extractedText);
    return {
      status: "complete",
      extractedText,
      details: {
        strategy: "mammoth",
        messages: parsed.messages?.length ?? 0,
        extractedBytes: Buffer.byteLength(extractedText, "utf8"),
        ...chunk,
      },
    };
  }

  if (isImageContent(contentType, extension)) {
    return {
      status: "skipped",
      extractionError: "OCR not enabled for image files in V1",
      details: { strategy: "skip_image" },
    };
  }

  return {
    status: "skipped",
    extractionError: "Unsupported file type for extraction",
    details: { strategy: "skip_unsupported", contentType, extension },
  };
}

async function enqueueProjectContextSync(projectId: string, db: Db) {
  const context = projectContextService(db);
  const sync = projectContextSyncService(db);
  let created = false;
  try {
    await context.createMaintenanceRequest({
      projectId,
      actorUserId: null,
      payload: {
        type: "context_summary",
        description: "Refresh project context from newly extracted files",
        contextRef: null,
      },
    });
    created = true;
  } catch (error) {
    if (!(error instanceof HttpError) || error.status !== 409) {
      throw error;
    }
  }
  if (created) {
    await sync.dispatchPendingForProject(projectId);
  }
}

export function projectContextExtractionService(db: Db, storage: StorageService) {
  const files = projectContextFileService(db);

  async function markStuckProcessingAsPending() {
    const stuck = await db
      .select({
        id: projectContextFiles.id,
        projectId: projectContextFiles.projectId,
      })
      .from(projectContextFiles)
      .where(eq(projectContextFiles.extractionStatus, "processing"))
      .limit(500);
    for (const row of stuck) {
      await files.setExtractionStatus({
        projectId: row.projectId,
        fileId: row.id,
        status: "pending",
        extractionError: null,
        eventDetails: { recovery: "startup_reset_processing_to_pending" },
      });
    }
    return stuck.length;
  }

  async function claimNextPending(): Promise<FileRow | null> {
    const next = await db
      .select()
      .from(projectContextFiles)
      .where(eq(projectContextFiles.extractionStatus, "pending"))
      .orderBy(asc(projectContextFiles.createdAt))
      .limit(1)
      .then((rows) => rows[0] ?? null);
    if (!next) return null;

    const [claimed] = await db
      .update(projectContextFiles)
      .set({
        extractionStatus: "processing",
        extractionError: null,
        updatedAt: new Date(),
      })
      .where(and(eq(projectContextFiles.id, next.id), eq(projectContextFiles.extractionStatus, "pending")))
      .returning();
    if (!claimed) return null;

    return claimed;
  }

  async function processOne(claimed: FileRow) {
    const asset = await db
      .select({
        id: assets.id,
        companyId: assets.companyId,
        objectKey: assets.objectKey,
        contentType: assets.contentType,
        byteSize: assets.byteSize,
        originalFilename: assets.originalFilename,
      })
      .from(assets)
      .where(and(eq(assets.id, claimed.assetId), eq(assets.companyId, claimed.companyId)))
      .then((rows) => rows[0] ?? null);
    if (!asset) {
      await files.setExtractionStatus({
        projectId: claimed.projectId,
        fileId: claimed.id,
        status: "failed",
        extractionError: "Asset no longer exists",
        eventDetails: { code: "asset_missing" },
      });
      return "failed";
    }
    if (asset.byteSize > PROJECT_DOC_MAX_BYTES) {
      await files.setExtractionStatus({
        projectId: claimed.projectId,
        fileId: claimed.id,
        status: "failed",
        extractionError: `File exceeds max bytes (${PROJECT_DOC_MAX_BYTES})`,
        eventDetails: {
          code: "file_too_large",
          maxBytes: PROJECT_DOC_MAX_BYTES,
          byteSize: asset.byteSize,
        },
      });
      return "failed";
    }

    try {
      const object = await storage.getObject(claimed.companyId, asset.objectKey);
      const buffer = await readStreamToBuffer(object.stream);
      const result = await extractTextFromBuffer({
        contentType: asset.contentType,
        originalFilename: asset.originalFilename,
        buffer,
      });

      if (result.status === "complete") {
        await files.setExtractionStatus({
          projectId: claimed.projectId,
          fileId: claimed.id,
          status: "complete",
          extractedText: result.extractedText,
          extractionError: null,
          eventDetails: result.details,
        });
        await enqueueProjectContextSync(claimed.projectId, db);
        return "complete";
      }

      await files.setExtractionStatus({
        projectId: claimed.projectId,
        fileId: claimed.id,
        status: "skipped",
        extractedText: null,
        extractionError: result.extractionError,
        eventDetails: result.details,
      });
      return "skipped";
    } catch (error) {
      logger.error({ err: error, projectId: claimed.projectId, fileId: claimed.id }, "project context extraction failed");
      await files.setExtractionStatus({
        projectId: claimed.projectId,
        fileId: claimed.id,
        status: "failed",
        extractionError: error instanceof Error ? error.message : "Unknown extraction error",
        eventDetails: { code: "exception" },
      });
      return "failed";
    }
  }

  async function tickPendingExtractions() {
    const outcomes = { complete: 0, skipped: 0, failed: 0, processed: 0 };
    for (let i = 0; i < EXTRACTION_BATCH_SIZE; i += 1) {
      const claimed = await claimNextPending();
      if (!claimed) break;
      const outcome = await processOne(claimed);
      outcomes.processed += 1;
      outcomes[outcome] += 1;
    }
    return outcomes;
  }

  return {
    markStuckProcessingAsPending,
    tickPendingExtractions,
  };
}
