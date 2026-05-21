import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { companyWalletReservations, companyWalletTransactions, heartbeatRuns } from "@paperclipai/db";
import {
  WALLET_INSUFFICIENT_AVAILABLE_TOAST,
  WALLET_PAYMENT_ERROR_CODE,
  walletInsufficientAvailableUserMessage,
} from "@paperclipai/shared";
import { paymentRequired } from "../errors.js";
import { getCompanyWalletTotals } from "./stripe-billing.js";

export const WALLET_RESERVATION_STATUS = {
  active: "active",
  settled: "settled",
  released: "released",
} as const;

export type WalletReservationStatus =
  (typeof WALLET_RESERVATION_STATUS)[keyof typeof WALLET_RESERVATION_STATUS];

export type WalletAvailability = {
  netCents: number;
  reservedCents: number;
  availableCents: number;
};

type DbExecutor = Pick<Db, "select" | "insert" | "update" | "execute" | "transaction">;

/** Placeholder until run-cost estimation is wired; inject non-zero holds via tryReserve estimateCents. */
export function estimateRunHoldCents(_run?: typeof heartbeatRuns.$inferSelect): number {
  return 0;
}

async function lockCompanyWallet(tx: DbExecutor, companyId: string) {
  await tx.execute(sql`select id from companies where id = ${companyId} for update`);
}

export async function getWalletAvailability(
  db: DbExecutor,
  companyId: string,
): Promise<WalletAvailability> {
  const wallet = await getCompanyWalletTotals(db as Db, companyId);
  const [reserveRow] = await db
    .select({
      total: sql<number>`coalesce(sum(${companyWalletReservations.estimatedCents}), 0)::bigint`,
    })
    .from(companyWalletReservations)
    .where(
      and(
        eq(companyWalletReservations.companyId, companyId),
        eq(companyWalletReservations.status, WALLET_RESERVATION_STATUS.active),
      ),
    );
  const reservedCents = Number(reserveRow?.total ?? 0);
  const availableCents = wallet.netCents - reservedCents;
  return {
    netCents: wallet.netCents,
    reservedCents,
    availableCents,
  };
}

export async function settleWalletReservationInTx(
  tx: DbExecutor,
  input: {
    heartbeatRunId: string;
    actualCents: number;
    costEventId: string;
  },
) {
  const actualCents = Math.max(0, Math.trunc(input.actualCents));
  const reservation = await tx
    .select()
    .from(companyWalletReservations)
    .where(eq(companyWalletReservations.heartbeatRunId, input.heartbeatRunId))
    .then((rows) => rows[0] ?? null);

  if (!reservation) return null;
  if (reservation.status === WALLET_RESERVATION_STATUS.settled) {
    return reservation;
  }
  if (reservation.status !== WALLET_RESERVATION_STATUS.active) {
    return reservation;
  }

  await lockCompanyWallet(tx, reservation.companyId);
  const now = new Date();

  const updated = await tx
    .update(companyWalletReservations)
    .set({
      status: WALLET_RESERVATION_STATUS.settled,
      settledCents: actualCents,
      costEventId: input.costEventId,
      updatedAt: now,
    })
    .where(
      and(
        eq(companyWalletReservations.id, reservation.id),
        eq(companyWalletReservations.status, WALLET_RESERVATION_STATUS.active),
      ),
    )
    .returning()
    .then((rows) => rows[0] ?? null);

  if (!updated) {
    return tx
      .select()
      .from(companyWalletReservations)
      .where(eq(companyWalletReservations.heartbeatRunId, input.heartbeatRunId))
      .then((rows) => rows[0] ?? null);
  }

  if (actualCents > 0) {
    await tx
      .insert(companyWalletTransactions)
      .values({
        companyId: reservation.companyId,
        amountCents: actualCents,
        currency: "usd",
        direction: "debit",
        sourceType: "cost_event_model_debit",
        sourceId: input.costEventId,
        metadataJson: {
          costEventId: input.costEventId,
          heartbeatRunId: input.heartbeatRunId,
          walletReservationId: reservation.id,
        },
      })
      .onConflictDoNothing();
  }

  return updated;
}

export function walletReservationService(db: Db) {
  return {
    estimateRunHoldCents,

    getAvailability: (companyId: string) => getWalletAvailability(db, companyId),

    tryReserve: async (input: {
      companyId: string;
      heartbeatRunId: string;
      estimateCents?: number;
    }) => {
      const estimateCents = Math.max(0, Math.trunc(input.estimateCents ?? estimateRunHoldCents()));

      return db.transaction(async (tx) => {
        await lockCompanyWallet(tx, input.companyId);

        const existing = await tx
          .select()
          .from(companyWalletReservations)
          .where(eq(companyWalletReservations.heartbeatRunId, input.heartbeatRunId))
          .then((rows) => rows[0] ?? null);

        if (existing) {
          if (existing.status === WALLET_RESERVATION_STATUS.active) {
            return existing;
          }
          throw paymentRequired("Wallet reservation is no longer active for this run", {
            code: WALLET_PAYMENT_ERROR_CODE.RESERVATION_INACTIVE,
            heartbeatRunId: input.heartbeatRunId,
            status: existing.status,
          });
        }

        const availability = await getWalletAvailability(tx, input.companyId);
        if (estimateCents > availability.availableCents) {
          throw paymentRequired(walletInsufficientAvailableUserMessage(), {
            code: WALLET_PAYMENT_ERROR_CODE.INSUFFICIENT_AVAILABLE,
            title: WALLET_INSUFFICIENT_AVAILABLE_TOAST.title,
            estimateCents,
            availableCents: availability.availableCents,
            netCents: availability.netCents,
            reservedCents: availability.reservedCents,
          });
        }

        const now = new Date();
        return tx
          .insert(companyWalletReservations)
          .values({
            companyId: input.companyId,
            heartbeatRunId: input.heartbeatRunId,
            estimatedCents: estimateCents,
            status: WALLET_RESERVATION_STATUS.active,
            createdAt: now,
            updatedAt: now,
          })
          .returning()
          .then((rows) => rows[0]);
      });
    },

    settle: async (input: {
      heartbeatRunId: string;
      actualCents: number;
      costEventId: string;
    }) => db.transaction((tx) => settleWalletReservationInTx(tx, input)),

    release: async (heartbeatRunId: string) => {
      const now = new Date();
      return db
        .update(companyWalletReservations)
        .set({
          status: WALLET_RESERVATION_STATUS.released,
          updatedAt: now,
        })
        .where(
          and(
            eq(companyWalletReservations.heartbeatRunId, heartbeatRunId),
            eq(companyWalletReservations.status, WALLET_RESERVATION_STATUS.active),
          ),
        )
        .returning()
        .then((rows) => rows[0] ?? null);
    },

    releaseIfActive: async (heartbeatRunId: string) => {
      return walletReservationService(db).release(heartbeatRunId);
    },

    /** Safety net: active holds for runs that already reached a terminal status. */
    releaseStaleForTerminalRuns: async (companyId?: string) => {
      const conditions = [
        eq(companyWalletReservations.status, WALLET_RESERVATION_STATUS.active),
        sql`${heartbeatRuns.status} in ('succeeded', 'failed', 'cancelled', 'timed_out')`,
      ];
      if (companyId) {
        conditions.push(eq(companyWalletReservations.companyId, companyId));
      }

      const stale = await db
        .select({ heartbeatRunId: companyWalletReservations.heartbeatRunId })
        .from(companyWalletReservations)
        .innerJoin(heartbeatRuns, eq(companyWalletReservations.heartbeatRunId, heartbeatRuns.id))
        .where(and(...conditions));

      let released = 0;
      const service = walletReservationService(db);
      for (const row of stale) {
        const result = await service.release(row.heartbeatRunId);
        if (result) released += 1;
      }
      return released;
    },
  };
}

export async function hasActiveWalletReservation(
  db: DbExecutor,
  heartbeatRunId: string | null | undefined,
): Promise<boolean> {
  if (!heartbeatRunId) return false;
  const row = await db
    .select({ id: companyWalletReservations.id })
    .from(companyWalletReservations)
    .where(
      and(
        eq(companyWalletReservations.heartbeatRunId, heartbeatRunId),
        eq(companyWalletReservations.status, WALLET_RESERVATION_STATUS.active),
      ),
    )
    .limit(1)
    .then((rows) => rows[0] ?? null);
  return Boolean(row);
}
