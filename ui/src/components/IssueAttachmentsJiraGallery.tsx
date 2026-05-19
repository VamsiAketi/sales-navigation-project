import { useMemo, useRef, useState, type ChangeEvent } from "react";
import { Link } from "@/lib/router";
import type { IssueAttachment } from "@paperclipai/shared";
import { ChevronDown, FileText, MoreHorizontal, Play, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ImageLightbox } from "./ImageLightbox";
import { issueAttachmentDownloadUrl, isIssueAttachmentContentUrl } from "@/lib/issue-attachment-content";
import type { AttachmentOriginSummary } from "@/lib/issue-attachment-markdown-refs";

function middleTruncateFilename(name: string, maxLen = 22): string {
  if (name.length <= maxLen) return name;
  const extIdx = name.lastIndexOf(".");
  const ext = extIdx >= 0 ? name.slice(extIdx) : "";
  const base = extIdx >= 0 ? name.slice(0, extIdx) : name;
  const budget = maxLen - ext.length - 1;
  if (budget <= 6) return `${name.slice(0, maxLen - 1)}\u2026`;
  const left = Math.ceil((budget - 1) / 2);
  const right = Math.floor((budget - 1) / 2);
  return `${base.slice(0, left)}\u2026${base.slice(base.length - right)}${ext}`;
}

/** Jira-style: `04 May 2026, 12:44 PM` */
function formatJiraAttachmentTimestamp(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  const parts = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  const day = get("day");
  const month = get("month");
  const year = get("year");
  const hour = get("hour");
  const minute = get("minute");
  const dayPeriod = (get("dayPeriod") || "").toUpperCase();
  const suffix = dayPeriod ? ` ${dayPeriod}` : "";
  return `${day} ${month} ${year}, ${hour}:${minute}${suffix}`.trim();
}

function isImageType(ct: string) {
  return ct.startsWith("image/");
}

function isVideoType(ct: string) {
  return ct.startsWith("video/");
}

export interface IssueAttachmentsJiraGalleryProps {
  attachments: IssueAttachment[];
  originById?: Map<string, AttachmentOriginSummary>;
  isUploading?: boolean;
  onAddFiles?: (files: FileList) => void;
  onRefresh?: () => void;
}

export function IssueAttachmentsJiraGallery({
  attachments,
  originById,
  isUploading = false,
  onAddFiles,
  onRefresh,
}: IssueAttachmentsJiraGalleryProps) {
  const [open, setOpen] = useState(true);
  const [lightbox, setLightbox] = useState<IssueAttachment | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const sorted = useMemo(
    () =>
      [...attachments].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      ),
    [attachments],
  );

  const handlePickFiles = (e: ChangeEvent<HTMLInputElement>) => {
    const list = e.target.files;
    if (list && list.length > 0) onAddFiles?.(list);
    e.target.value = "";
  };

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-md border border-border bg-background">
      <input
        ref={fileRef}
        type="file"
        multiple
        className="hidden"
        onChange={handlePickFiles}
        aria-hidden
      />
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm font-semibold text-foreground hover:bg-accent/40 rounded-sm px-1 py-0.5 -mx-1 transition-colors"
          >
            <ChevronDown
              className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", !open && "-rotate-90")}
            />
            <span>Attachments</span>
            <Badge
              variant="secondary"
              className="rounded px-1.5 py-0 text-[11px] font-medium tabular-nums text-muted-foreground bg-muted/80 border border-border/60"
            >
              {sorted.length}
            </Badge>
          </button>
        </CollapsibleTrigger>
        <div className="flex shrink-0 items-center gap-0.5">
          {onRefresh ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="ghost" size="icon-xs" className="text-muted-foreground" title="More">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuItem onSelect={() => onRefresh()}>Reload attachments</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
          {onAddFiles ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="text-muted-foreground"
              title="Add attachment"
              disabled={isUploading}
              onClick={() => fileRef.current?.click()}
            >
              <Plus className="h-4 w-4" />
            </Button>
          ) : null}
        </div>
      </div>

      <CollapsibleContent>
        {sorted.length === 0 ? (
          <p className="px-3 py-4 text-xs text-muted-foreground">No attachments yet.</p>
        ) : (
          <div className="flex gap-3 overflow-x-auto px-3 py-3 pb-4">
            {sorted.map((att) => {
              const origin = originById?.get(att.id.toLowerCase()) ?? { kind: "issue_only" as const };
              const name = att.originalFilename ?? "Attachment";
              const img = isImageType(att.contentType);
              const video = isVideoType(att.contentType);
              const downloadHref =
                isIssueAttachmentContentUrl(att.contentPath) ? issueAttachmentDownloadUrl(att.contentPath) : undefined;

              return (
                <div
                  key={att.id}
                  className="flex w-[132px] shrink-0 flex-col overflow-hidden rounded-md border border-border bg-card shadow-sm"
                >
                  <button
                    type="button"
                    className="relative block h-24 w-full shrink-0 bg-muted/50 text-left outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => {
                      if (img) setLightbox(att);
                      else if (video) window.open(att.contentPath, "_blank", "noopener,noreferrer");
                      else if (downloadHref) window.open(downloadHref, "_blank", "noopener,noreferrer");
                    }}
                  >
                    {img ? (
                      <img
                        src={att.contentPath}
                        alt=""
                        className="h-full w-full object-cover"
                        loading="lazy"
                        draggable={false}
                      />
                    ) : video ? (
                      <>
                        <video
                          src={att.contentPath}
                          className="h-full w-full object-cover"
                          muted
                          playsInline
                          preload="metadata"
                        />
                        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/35">
                          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-black/55">
                            <Play className="h-5 w-5 translate-x-0.5 text-white" fill="currentColor" />
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                        <FileText className="h-8 w-8 opacity-70" />
                      </div>
                    )}
                  </button>
                  <div className="space-y-0.5 border-t border-border bg-background px-2 py-1.5">
                    <p className="truncate text-[11px] font-medium leading-tight text-foreground" title={name}>
                      {middleTruncateFilename(name)}
                    </p>
                    <p className="text-[10px] leading-tight text-muted-foreground">
                      {formatJiraAttachmentTimestamp(att.createdAt)}
                    </p>
                    <p className="text-[10px] leading-tight text-muted-foreground/90">
                      {origin.kind === "description" && "Description"}
                      {origin.kind === "issue_only" && "Issue"}
                      {origin.kind === "comment" && origin.commentId ? (
                        <Link to={`#comment-${origin.commentId}`} className="hover:underline">
                          Comment
                        </Link>
                      ) : null}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CollapsibleContent>

      {lightbox && isImageType(lightbox.contentType) ? (
        <ImageLightbox
          src={lightbox.contentPath}
          alt={lightbox.originalFilename ?? "Attachment"}
          downloadHref={
            isIssueAttachmentContentUrl(lightbox.contentPath)
              ? issueAttachmentDownloadUrl(lightbox.contentPath)
              : undefined
          }
          onClose={() => setLightbox(null)}
        />
      ) : null}
    </Collapsible>
  );
}
