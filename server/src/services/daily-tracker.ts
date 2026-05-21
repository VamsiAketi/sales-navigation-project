import { and, asc, eq, gte, isNull, lt, ne, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { activityLog, companies, issues, projects } from "@paperclipai/db";
import { logger } from "../middleware/logger.js";
import { logActivity } from "./activity-log.js";

const DAILY_TRACKER_TIMEOUT_MS = 10_000;
const DAILY_TRACKER_POLL_INTERVAL_MS = 60 * 60 * 1000; // hourly
const DAILY_TRACKER_ACTIVITY_ACTION = "daily_tracker.sent";

interface DailyTrackerProjectPayload {
  projectId: string;
  projectName: string;
  tasksClosedCount: number;
  tasksClosed: string[];
}

interface DailyTrackerPayload {
  date: string;
  tenantId: string;
  totalTasksClosedCount: number;
  projects: DailyTrackerProjectPayload[];
}

function resolveTenantIdFromEnv(): string {
  return (
    process.env.MS_GRAPH_TENANT_ID_EMAIL?.trim() ||
    process.env.AI_HARNESS_AUTH_MICROSOFT_TENANT_ID?.trim() ||
    process.env.PAPERCLIP_AUTH_MICROSOFT_TENANT_ID?.trim() ||
    ""
  );
}

function resolveControlPlaneDailyTrackerEndpoint(): string | null {
  const base = process.env.CONTROL_PLANE_URL?.trim();
  if (!base) return null;
  return `${base.replace(/\/+$/, "")}/api/internal/ticket-closure`;
}

function formatUtcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function utcDayWindowForPreviousDay(now: Date) {
  const utcStartToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
  const endUtcExclusive = utcStartToday;
  const startUtc = new Date(endUtcExclusive.getTime() - 24 * 60 * 60 * 1000);
  return {
    date: formatUtcDay(startUtc),
    startUtc,
    endUtcExclusive,
  };
}

async function postDailyTrackerPayload(endpoint: string, payload: DailyTrackerPayload): Promise<boolean> {
  const internalSecret = process.env.INTERNAL_SECRET?.trim();
  if (!internalSecret) {
    logger.warn(
      { date: payload.date },
      "daily tracker skipped because INTERNAL_SECRET is missing",
    );
    return false;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DAILY_TRACKER_TIMEOUT_MS);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-internal-secret": internalSecret,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!response.ok) {
      logger.warn(
        {
          endpoint,
          status: response.status,
          date: payload.date,
        },
        "daily tracker API returned non-ok status",
      );
      return false;
    }
    return true;
  } catch (error) {
    logger.warn(
      {
        error,
        endpoint,
        date: payload.date,
      },
      "failed to post daily tracker payload to control plane",
    );
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

export function dailyTrackerService(db: Db) {
  let nextPollAtMs = 0;
  let warnedMissingConfig = false;

  async function alreadySentForDate(companyId: string, date: string): Promise<boolean> {
    const rows = await db
      .select({ id: activityLog.id })
      .from(activityLog)
      .where(
        and(
          eq(activityLog.companyId, companyId),
          eq(activityLog.action, DAILY_TRACKER_ACTIVITY_ACTION),
          sql`${activityLog.details} ->> 'date' = ${date}`,
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  async function buildPayload(companyId: string, date: string, startUtc: Date, endUtcExclusive: Date): Promise<DailyTrackerPayload> {
    const tenantId = resolveTenantIdFromEnv();

    const closedRows = await db
      .select({
        projectId: projects.id,
        projectName: projects.name,
        issueTitle: issues.title,
      })
      .from(issues)
      .innerJoin(
        projects,
        and(
          eq(issues.projectId, projects.id),
          eq(projects.companyId, companyId),
          isNull(projects.archivedAt),
        ),
      )
      .where(
        and(
          eq(issues.companyId, companyId),
          eq(issues.status, "done"),
          ne(issues.title, ""),
          gte(issues.completedAt, startUtc),
          lt(issues.completedAt, endUtcExclusive),
        ),
      )
      .orderBy(asc(projects.name), asc(issues.completedAt), asc(issues.createdAt));

    const grouped = new Map<string, DailyTrackerProjectPayload>();
    for (const row of closedRows) {
      const key = row.projectId;
      const existing = grouped.get(key);
      const title = row.issueTitle.trim();
      if (!existing) {
        grouped.set(key, {
          projectId: row.projectId,
          projectName: row.projectName,
          tasksClosedCount: 1,
          tasksClosed: [title],
        });
        continue;
      }
      existing.tasksClosedCount += 1;
      existing.tasksClosed.push(title);
    }

    const projectsPayload = [...grouped.values()];
    const totalTasksClosedCount = projectsPayload.reduce((sum, item) => sum + item.tasksClosedCount, 0);
    return {
      date,
      tenantId,
      totalTasksClosedCount,
      projects: projectsPayload,
    };
  }

  async function runForPreviousUtcDay(now: Date): Promise<void> {
    const endpoint = resolveControlPlaneDailyTrackerEndpoint();
    if (!endpoint) {
      if (!warnedMissingConfig) {
        warnedMissingConfig = true;
        logger.info(
          "daily tracker disabled (set CONTROL_PLANE_URL to enable)",
        );
      }
      return;
    }
    warnedMissingConfig = false;
    const companiesToTrack = await db
      .select({ id: companies.id, name: companies.name })
      .from(companies)
      .where(ne(companies.status, "archived"));
    if (companiesToTrack.length === 0) return;

    const { date, startUtc, endUtcExclusive } = utcDayWindowForPreviousDay(now);
    for (const company of companiesToTrack) {
      const alreadySent = await alreadySentForDate(company.id, date);
      if (alreadySent) continue;

      const payload = await buildPayload(company.id, date, startUtc, endUtcExclusive);
      const delivered = await postDailyTrackerPayload(endpoint, payload);
      if (!delivered) continue;

      await logActivity(db, {
        companyId: company.id,
        actorType: "system",
        actorId: "daily-tracker",
        action: DAILY_TRACKER_ACTIVITY_ACTION,
        entityType: "company",
        entityId: company.id,
        details: {
          date,
          totalTasksClosedCount: payload.totalTasksClosedCount,
          projectCount: payload.projects.length,
        },
      });

      logger.info(
        {
          companyId: company.id,
          companyName: company.name,
          date,
          totalTasksClosedCount: payload.totalTasksClosedCount,
          projectCount: payload.projects.length,
        },
        "daily tracker payload delivered",
      );
    }
  }

  return {
    async tick(now: Date) {
      const nowMs = now.getTime();
      if (nowMs < nextPollAtMs) return;
      nextPollAtMs = nowMs + DAILY_TRACKER_POLL_INTERVAL_MS;
      await runForPreviousUtcDay(now);
    },
  };
}
