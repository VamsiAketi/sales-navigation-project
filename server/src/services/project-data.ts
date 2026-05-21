import { and, asc, eq, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  projectDataObjectRevisions,
  projectDataObjects,
  projects,
  projectViews,
  projectViewWidgets,
} from "@paperclipai/db";
import type {
  AddProjectDataColumn,
  CreateProjectDataTable,
  CreateProjectView,
  CreateProjectViewWidget,
  ProjectDataQuery,
  UpdateProjectViewWidget,
} from "@paperclipai/shared";
import { conflict, notFound, unprocessable } from "../errors.js";

const IDENTIFIER_REGEX = /^[a-z][a-z0-9_]{0,62}$/;
const DDL_TYPES: Record<string, string> = {
  text: "text",
  int: "integer",
  bigint: "bigint",
  numeric: "numeric",
  bool: "boolean",
  uuid: "uuid",
  timestamptz: "timestamptz",
  jsonb: "jsonb",
};

function quoteIdent(value: string): string {
  if (!IDENTIFIER_REGEX.test(value)) {
    throw unprocessable(`Invalid identifier: ${value}`);
  }
  return `"${value}"`;
}

function qualify(schemaName: string, objectName: string): string {
  return `${quoteIdent(schemaName)}.${quoteIdent(objectName)}`;
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase();
}

function extractRows<T = Record<string, unknown>>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === "object" && "rows" in (result as Record<string, unknown>)) {
    const rows = (result as { rows?: unknown }).rows;
    return Array.isArray(rows) ? (rows as T[]) : [];
  }
  return [];
}

function defaultExpressionSql(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed === "now()" || trimmed === "gen_random_uuid()") return trimmed;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return trimmed;
  if (/^(true|false)$/i.test(trimmed)) return trimmed.toLowerCase();
  throw unprocessable(`Unsupported default expression: ${trimmed}`);
}

function buildColumnSql(column: CreateProjectDataTable["columns"][number] | AddProjectDataColumn): string {
  const ddlType = DDL_TYPES[column.type];
  if (!ddlType) throw unprocessable(`Unsupported column type: ${column.type}`);
  const base = `${quoteIdent(column.name)} ${ddlType}`;
  const nullable = column.nullable === false ? " NOT NULL" : "";
  const defaultExpr = defaultExpressionSql(column.default);
  const defaultSql = defaultExpr ? ` DEFAULT ${defaultExpr}` : "";
  return `${base}${defaultSql}${nullable}`;
}

function toDataObjectDefinition(input: {
  kind: "table" | "view";
  name: string;
  payload: Record<string, unknown>;
  schemaName: string;
}) {
  return {
    kind: input.kind,
    name: input.name,
    schemaName: input.schemaName,
    ...input.payload,
  };
}

export function projectDataService(db: Db) {
  async function ensureProjectSchema(projectId: string): Promise<{ projectId: string; companyId: string; schemaName: string }> {
    const project = await db
      .select({ id: projects.id, companyId: projects.companyId, dataSchemaName: projects.dataSchemaName })
      .from(projects)
      .where(eq(projects.id, projectId))
      .then((rows) => rows[0] ?? null);
    if (!project) throw notFound("Project not found");
    let schemaName = project.dataSchemaName;
    if (!schemaName) {
      schemaName = `prj_${project.id.replaceAll("-", "").slice(0, 12)}`;
      await db.update(projects).set({ dataSchemaName: schemaName, updatedAt: new Date() }).where(eq(projects.id, project.id));
    }
    quoteIdent(schemaName);
    await db.execute(sql.raw(`CREATE SCHEMA IF NOT EXISTS ${quoteIdent(schemaName)}`));
    return { projectId: project.id, companyId: project.companyId, schemaName };
  }

  async function insertDataObjectRevision(input: {
    companyId: string;
    projectId: string;
    objectId: string;
    kind: "table" | "view";
    name: string;
    definition: Record<string, unknown>;
    createdByUserId?: string | null;
    createdByAgentId?: string | null;
    createdByRunId?: string | null;
    changeSource?: "human" | "agent_sync" | "system";
    changeSummary?: string | null;
  }) {
    const latest = await db
      .select({ latestRevisionNumber: projectDataObjects.latestRevisionNumber })
      .from(projectDataObjects)
      .where(eq(projectDataObjects.id, input.objectId))
      .then((rows) => rows[0]?.latestRevisionNumber ?? 0);
    const revisionNumber = latest + 1;
    await db.insert(projectDataObjectRevisions).values({
      companyId: input.companyId,
      projectId: input.projectId,
      projectDataObjectId: input.objectId,
      revisionNumber,
      kind: input.kind,
      name: input.name,
      definition: input.definition,
      changeSource: input.changeSource ?? "human",
      changeSummary: input.changeSummary ?? null,
      createdByUserId: input.createdByUserId ?? null,
      createdByAgentId: input.createdByAgentId ?? null,
      createdByRunId: input.createdByRunId ?? null,
    });
    await db
      .update(projectDataObjects)
      .set({ latestRevisionNumber: revisionNumber, updatedAt: new Date() })
      .where(eq(projectDataObjects.id, input.objectId));
  }

  return {
    ensureProjectSchema,

    listDataObjects: async (projectId: string) => {
      const rows = await db
        .select()
        .from(projectDataObjects)
        .where(eq(projectDataObjects.projectId, projectId))
        .orderBy(asc(projectDataObjects.kind), asc(projectDataObjects.normalizedName));
      return rows.map((row) => ({
        ...row,
        definition: (row.definition as Record<string, unknown>) ?? {},
      }));
    },

    createTable: async (input: {
      projectId: string;
      payload: CreateProjectDataTable;
      createdByUserId?: string | null;
      createdByAgentId?: string | null;
      createdByRunId?: string | null;
    }) => {
      const scope = await ensureProjectSchema(input.projectId);
      const tableName = normalizeName(input.payload.name);
      quoteIdent(tableName);
      const normalizedName = tableName;
      const existing = await db
        .select({ id: projectDataObjects.id })
        .from(projectDataObjects)
        .where(and(eq(projectDataObjects.projectId, scope.projectId), eq(projectDataObjects.normalizedName, normalizedName)))
        .then((rows) => rows[0] ?? null);
      if (existing) throw conflict(`Data object "${tableName}" already exists`);

      const columnSql = input.payload.columns.map((column) => buildColumnSql(column));
      const pkSql = `PRIMARY KEY (${input.payload.primaryKey.map((value) => quoteIdent(value)).join(", ")})`;
      const fkSql = (input.payload.foreignKeys ?? []).map((fk, idx) => {
        const columns = fk.columns.map((value) => quoteIdent(value)).join(", ");
        const refColumns = fk.references.columns.map((value) => quoteIdent(value)).join(", ");
        return `CONSTRAINT ${quoteIdent(`fk_${tableName}_${idx + 1}`)} FOREIGN KEY (${columns}) REFERENCES ${qualify(scope.schemaName, normalizeName(fk.references.table))} (${refColumns}) ON DELETE ${(fk.onDelete ?? "restrict").toUpperCase()}`;
      });
      const statement = `CREATE TABLE ${qualify(scope.schemaName, tableName)} (${[...columnSql, pkSql, ...fkSql].join(", ")})`;
      await db.execute(sql.raw(statement));

      const definition = toDataObjectDefinition({
        kind: "table",
        name: tableName,
        schemaName: scope.schemaName,
        payload: input.payload as unknown as Record<string, unknown>,
      });
      const [created] = await db
        .insert(projectDataObjects)
        .values({
          companyId: scope.companyId,
          projectId: scope.projectId,
          kind: "table",
          name: tableName,
          normalizedName,
          schemaName: scope.schemaName,
          definition,
          latestRevisionNumber: 0,
        })
        .returning();
      await insertDataObjectRevision({
        companyId: scope.companyId,
        projectId: scope.projectId,
        objectId: created!.id,
        kind: "table",
        name: tableName,
        definition,
        createdByUserId: input.createdByUserId ?? null,
        createdByAgentId: input.createdByAgentId ?? null,
        createdByRunId: input.createdByRunId ?? null,
      });
      return created!;
    },

    addTableColumn: async (input: {
      projectId: string;
      tableName: string;
      payload: AddProjectDataColumn;
      createdByUserId?: string | null;
      createdByAgentId?: string | null;
      createdByRunId?: string | null;
    }) => {
      const scope = await ensureProjectSchema(input.projectId);
      const tableName = normalizeName(input.tableName);
      quoteIdent(tableName);
      const statement = `ALTER TABLE ${qualify(scope.schemaName, tableName)} ADD COLUMN ${buildColumnSql(input.payload)}`;
      await db.execute(sql.raw(statement));
      const existing = await db
        .select()
        .from(projectDataObjects)
        .where(
          and(
            eq(projectDataObjects.projectId, scope.projectId),
            eq(projectDataObjects.kind, "table"),
            eq(projectDataObjects.normalizedName, tableName),
          ),
        )
        .then((rows) => rows[0] ?? null);
      if (!existing) throw notFound("Table metadata not found");
      const definition = {
        ...(existing.definition as Record<string, unknown>),
        lastOperation: "add_column",
        lastColumn: input.payload,
      };
      await db.update(projectDataObjects).set({ definition, updatedAt: new Date() }).where(eq(projectDataObjects.id, existing.id));
      await insertDataObjectRevision({
        companyId: scope.companyId,
        projectId: scope.projectId,
        objectId: existing.id,
        kind: "table",
        name: tableName,
        definition,
        createdByUserId: input.createdByUserId ?? null,
        createdByAgentId: input.createdByAgentId ?? null,
        createdByRunId: input.createdByRunId ?? null,
      });
      return { tableName, column: input.payload };
    },

    createViewObject: async (input: {
      projectId: string;
      payload: Record<string, unknown> & { name: string };
      createdByUserId?: string | null;
      createdByAgentId?: string | null;
      createdByRunId?: string | null;
    }) => {
      const scope = await ensureProjectSchema(input.projectId);
      const name = normalizeName(input.payload.name);
      quoteIdent(name);
      const normalizedName = name;
      const existing = await db
        .select({ id: projectDataObjects.id })
        .from(projectDataObjects)
        .where(and(eq(projectDataObjects.projectId, scope.projectId), eq(projectDataObjects.normalizedName, normalizedName)))
        .then((rows) => rows[0] ?? null);
      if (existing) throw conflict(`Data object "${name}" already exists`);

      const base = typeof input.payload.base === "object" && input.payload.base !== null
        ? (input.payload.base as { table?: string })
        : null;
      const baseTable = normalizeName(base?.table ?? "");
      if (!baseTable) throw unprocessable("View payload.base.table is required");
      const selectParts = Array.isArray(input.payload.select) ? input.payload.select : [];
      if (selectParts.length === 0) throw unprocessable("View payload.select is required");
      const selectSql = selectParts
        .map((item) => {
          if (typeof item === "string") return item;
          if (item && typeof item === "object") {
            const expr = (item as { expr?: string }).expr;
            const as = (item as { as?: string }).as;
            if (expr && as) return `${expr} AS ${quoteIdent(normalizeName(as))}`;
          }
          throw unprocessable("Invalid select entry in view payload");
        })
        .join(", ");
      const statement = `CREATE OR REPLACE VIEW ${qualify(scope.schemaName, name)} AS SELECT ${selectSql} FROM ${qualify(scope.schemaName, baseTable)}`;
      await db.execute(sql.raw(statement));

      const definition = toDataObjectDefinition({
        kind: "view",
        name,
        schemaName: scope.schemaName,
        payload: input.payload,
      });
      const [created] = await db
        .insert(projectDataObjects)
        .values({
          companyId: scope.companyId,
          projectId: scope.projectId,
          kind: "view",
          name,
          normalizedName,
          schemaName: scope.schemaName,
          definition,
          latestRevisionNumber: 0,
        })
        .returning();
      await insertDataObjectRevision({
        companyId: scope.companyId,
        projectId: scope.projectId,
        objectId: created!.id,
        kind: "view",
        name,
        definition,
        createdByUserId: input.createdByUserId ?? null,
        createdByAgentId: input.createdByAgentId ?? null,
        createdByRunId: input.createdByRunId ?? null,
      });
      return created!;
    },

    queryData: async (input: { projectId: string; payload: ProjectDataQuery }) => {
      const scope = await ensureProjectSchema(input.projectId);
      const name = normalizeName(input.payload.ref.name);
      quoteIdent(name);
      const target = qualify(scope.schemaName, name);
      const whereParts = (input.payload.filters ?? []).map((filter) => {
        const col = quoteIdent(normalizeName(filter.column));
        switch (filter.op) {
          case "eq": return sql`${sql.raw(col)} = ${filter.value}`;
          case "neq": return sql`${sql.raw(col)} <> ${filter.value}`;
          case "gt": return sql`${sql.raw(col)} > ${filter.value}`;
          case "gte": return sql`${sql.raw(col)} >= ${filter.value}`;
          case "lt": return sql`${sql.raw(col)} < ${filter.value}`;
          case "lte": return sql`${sql.raw(col)} <= ${filter.value}`;
          case "is_null": return sql`${sql.raw(col)} IS NULL`;
          case "like": return sql`${sql.raw(col)} LIKE ${String(filter.value ?? "")}`;
          case "in": {
            if (!Array.isArray(filter.value) || filter.value.length === 0) {
              throw unprocessable("IN filter requires non-empty array");
            }
            return sql`${sql.raw(col)} IN (${sql.join(filter.value.map((value) => sql`${value}`), sql`, `)})`;
          }
          default:
            throw unprocessable(`Unsupported filter op: ${filter.op}`);
        }
      });

      const orderBy = (input.payload.orderBy ?? []).map((entry) => {
        const col = quoteIdent(normalizeName(entry.column));
        const dir = (entry.direction ?? "asc").toUpperCase() === "DESC" ? "DESC" : "ASC";
        return `${col} ${dir}`;
      });
      const limit = Math.min(100, Math.max(1, input.payload.limit ?? 50));
      const offset = Math.min(10000, Math.max(0, input.payload.offset ?? 0));

      const query = sql`
        SELECT *
        FROM ${sql.raw(target)}
        ${whereParts.length > 0 ? sql`WHERE ${sql.join(whereParts, sql` AND `)}` : sql``}
        ${orderBy.length > 0 ? sql`ORDER BY ${sql.raw(orderBy.join(", "))}` : sql``}
        LIMIT ${limit}
        OFFSET ${offset}
      `;
      const result = await db.execute(query);
      return { rows: extractRows(result), limit, offset };
    },

    insertRows: async (input: {
      projectId: string;
      table: string;
      rows: Record<string, unknown>[];
    }) => {
      const scope = await ensureProjectSchema(input.projectId);
      const tableName = normalizeName(input.table);
      quoteIdent(tableName);
      if (!Array.isArray(input.rows) || input.rows.length === 0) throw unprocessable("rows must be non-empty");
      if (input.rows.length > Number(process.env.PAPERCLIP_DATA_ROWS_BULK_MAX ?? 200)) {
        throw unprocessable("Too many rows for a single request");
      }
      const columns = Object.keys(input.rows[0] ?? {}).map((key) => normalizeName(key));
      if (columns.length === 0) throw unprocessable("rows must include at least one column");
      const uniqueColumns = [...new Set(columns)];
      uniqueColumns.forEach((col) => quoteIdent(col));
      const query = sql`
        INSERT INTO ${sql.raw(qualify(scope.schemaName, tableName))}
          (${sql.raw(uniqueColumns.map((col) => quoteIdent(col)).join(", "))})
        VALUES
          ${sql.join(
            input.rows.map((row) => sql`(${sql.join(uniqueColumns.map((col) => sql`${row[col]}`), sql`, `)})`),
            sql`, `,
          )}
        RETURNING *
      `;
      const result = await db.execute(query);
      return extractRows(result);
    },

    updateRowByPk: async (input: {
      projectId: string;
      table: string;
      primaryKey: Record<string, unknown>;
      patch: Record<string, unknown>;
    }) => {
      const scope = await ensureProjectSchema(input.projectId);
      const tableName = normalizeName(input.table);
      quoteIdent(tableName);
      const patchEntries = Object.entries(input.patch ?? {});
      if (patchEntries.length === 0) throw unprocessable("patch is required");
      const pkEntries = Object.entries(input.primaryKey ?? {});
      if (pkEntries.length === 0) throw unprocessable("primaryKey is required");
      const setClause = sql.join(
        patchEntries.map(([key, value]) => sql`${sql.raw(quoteIdent(normalizeName(key)))} = ${value}`),
        sql`, `,
      );
      const whereClause = sql.join(
        pkEntries.map(([key, value]) => sql`${sql.raw(quoteIdent(normalizeName(key)))} = ${value}`),
        sql` AND `,
      );
      const query = sql`
        UPDATE ${sql.raw(qualify(scope.schemaName, tableName))}
        SET ${setClause}
        WHERE ${whereClause}
        RETURNING *
      `;
      const result = await db.execute(query);
      const rows = extractRows(result);
      if (rows.length === 0) throw notFound("Row not found");
      return rows[0];
    },

    deleteRowByPk: async (input: {
      projectId: string;
      table: string;
      primaryKey: Record<string, unknown>;
    }) => {
      const scope = await ensureProjectSchema(input.projectId);
      const tableName = normalizeName(input.table);
      quoteIdent(tableName);
      const pkEntries = Object.entries(input.primaryKey ?? {});
      if (pkEntries.length === 0) throw unprocessable("primaryKey is required");
      const whereClause = sql.join(
        pkEntries.map(([key, value]) => sql`${sql.raw(quoteIdent(normalizeName(key)))} = ${value}`),
        sql` AND `,
      );
      const query = sql`
        DELETE FROM ${sql.raw(qualify(scope.schemaName, tableName))}
        WHERE ${whereClause}
        RETURNING *
      `;
      const result = await db.execute(query);
      const rows = extractRows(result);
      if (rows.length === 0) throw notFound("Row not found");
      return rows[0];
    },

    listViews: async (projectId: string) => {
      const rows = await db
        .select()
        .from(projectViews)
        .where(eq(projectViews.projectId, projectId))
        .orderBy(asc(projectViews.normalizedName));
      return rows.map((row) => ({ ...row, layout: (row.layout as Record<string, unknown> | null) ?? null }));
    },

    createView: async (input: { projectId: string; payload: CreateProjectView }) => {
      const scope = await ensureProjectSchema(input.projectId);
      const name = input.payload.name.trim();
      const normalizedName = normalizeName(name);
      const existing = await db
        .select({ id: projectViews.id })
        .from(projectViews)
        .where(and(eq(projectViews.projectId, scope.projectId), eq(projectViews.normalizedName, normalizedName)))
        .then((rows) => rows[0] ?? null);
      if (existing) throw conflict(`View "${name}" already exists`);
      const [created] = await db
        .insert(projectViews)
        .values({
          companyId: scope.companyId,
          projectId: scope.projectId,
          name,
          normalizedName,
          description: input.payload.description ?? null,
          layout: input.payload.layout ?? null,
        })
        .returning();
      return created!;
    },

    createWidget: async (input: { projectId: string; viewId: string; payload: CreateProjectViewWidget }) => {
      const view = await db
        .select()
        .from(projectViews)
        .where(and(eq(projectViews.id, input.viewId), eq(projectViews.projectId, input.projectId)))
        .then((rows) => rows[0] ?? null);
      if (!view) throw notFound("View not found");
      const title = input.payload.title?.trim() ?? null;
      const normalizedTitle = title ? normalizeName(title) : null;
      if (normalizedTitle) {
        const existing = await db
          .select({ id: projectViewWidgets.id })
          .from(projectViewWidgets)
          .where(
            and(
              eq(projectViewWidgets.projectViewId, view.id),
              eq(projectViewWidgets.companyId, view.companyId),
              eq(projectViewWidgets.normalizedTitle, normalizedTitle),
            ),
          )
          .then((rows) => rows[0] ?? null);
        if (existing) throw conflict(`Widget title "${title}" already exists in this view`);
      }
      const [created] = await db
        .insert(projectViewWidgets)
        .values({
          companyId: view.companyId,
          projectId: view.projectId,
          projectViewId: view.id,
          title,
          normalizedTitle,
          type: input.payload.type,
          position: input.payload.position ?? 0,
          queryRef: input.payload.queryRef ?? null,
          config: input.payload.config ?? null,
          layout: input.payload.layout ?? null,
        })
        .returning();
      return created!;
    },

    listWidgets: async (projectId: string, viewId: string) => {
      const rows = await db
        .select()
        .from(projectViewWidgets)
        .where(and(eq(projectViewWidgets.projectId, projectId), eq(projectViewWidgets.projectViewId, viewId)))
        .orderBy(asc(projectViewWidgets.position), asc(projectViewWidgets.createdAt));
      return rows.map((row) => ({
        ...row,
        queryRef: (row.queryRef as Record<string, unknown> | null) ?? null,
        config: (row.config as Record<string, unknown> | null) ?? null,
        layout: (row.layout as Record<string, unknown> | null) ?? null,
      }));
    },

    updateWidget: async (input: {
      projectId: string;
      viewId: string;
      widgetId: string;
      payload: UpdateProjectViewWidget;
    }) => {
      const existing = await db
        .select()
        .from(projectViewWidgets)
        .where(
          and(
            eq(projectViewWidgets.id, input.widgetId),
            eq(projectViewWidgets.projectId, input.projectId),
            eq(projectViewWidgets.projectViewId, input.viewId),
          ),
        )
        .then((rows) => rows[0] ?? null);
      if (!existing) throw notFound("Widget not found");
      const title = input.payload.title !== undefined ? input.payload.title?.trim() ?? null : existing.title;
      const normalizedTitle = title ? normalizeName(title) : null;
      if (normalizedTitle && normalizedTitle !== existing.normalizedTitle) {
        const dup = await db
          .select({ id: projectViewWidgets.id })
          .from(projectViewWidgets)
          .where(
            and(
              eq(projectViewWidgets.projectViewId, existing.projectViewId),
              eq(projectViewWidgets.companyId, existing.companyId),
              eq(projectViewWidgets.normalizedTitle, normalizedTitle),
            ),
          )
          .then((rows) => rows.find((row) => row.id !== existing.id) ?? null);
        if (dup) throw conflict(`Widget title "${title}" already exists in this view`);
      }
      const [updated] = await db
        .update(projectViewWidgets)
        .set({
          title,
          normalizedTitle,
          type: input.payload.type ?? existing.type,
          position: input.payload.position ?? existing.position,
          queryRef: input.payload.queryRef ?? existing.queryRef,
          config: input.payload.config ?? existing.config,
          layout: input.payload.layout ?? existing.layout,
          updatedAt: new Date(),
        })
        .where(eq(projectViewWidgets.id, existing.id))
        .returning();
      return updated!;
    },

    deleteWidget: async (projectId: string, viewId: string, widgetId: string) => {
      const [deleted] = await db
        .delete(projectViewWidgets)
        .where(
          and(
            eq(projectViewWidgets.id, widgetId),
            eq(projectViewWidgets.projectId, projectId),
            eq(projectViewWidgets.projectViewId, viewId),
          ),
        )
        .returning();
      if (!deleted) throw notFound("Widget not found");
      return deleted;
    },
  };
}
