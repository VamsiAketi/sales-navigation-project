import { describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";

vi.mock("../services/activity-log.js", () => ({
  logActivity: vi.fn(),
}));

const { hasWalletCreditForCheckoutSession, syncStripeCheckoutSessionCredit } = await import(
  "../services/stripe-billing.js"
);

describe("stripe billing idempotency", () => {
  it("syncStripeCheckoutSessionCredit is safe to call twice for the same paid session", async () => {
    const walletInsertChain = {
      values: vi.fn().mockReturnValue({
        onConflictDoNothing: vi.fn().mockReturnValue({
          returning: vi.fn()
            .mockResolvedValueOnce([{ id: "wallet-tx-1" }])
            .mockResolvedValueOnce([]),
        }),
      }),
    };
    const intentInsertChain = {
      values: vi.fn().mockReturnValue({
        onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
      }),
    };
    const insert = vi
      .fn()
      .mockReturnValueOnce(intentInsertChain)
      .mockReturnValueOnce(walletInsertChain)
      .mockReturnValueOnce(intentInsertChain)
      .mockReturnValueOnce(walletInsertChain);

    const db = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn()
              .mockResolvedValueOnce([])
              .mockResolvedValueOnce([{ id: "wallet-tx-1" }]),
          }),
        }),
      }),
      insert,
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined),
        }),
      }),
    } as unknown as Parameters<typeof syncStripeCheckoutSessionCredit>[0];

    const session = {
      id: "cs_test_123",
      payment_status: "paid",
      amount_total: 1000,
      currency: "usd",
      metadata: { paperclip_company_id: "company-1" },
    } as Stripe.Checkout.Session;

    const first = await syncStripeCheckoutSessionCredit(db, session);
    const second = await syncStripeCheckoutSessionCredit(db, session);

    expect(first).toBe("credited");
    expect(second).toBe("already_credited");
  });

  it("hasWalletCreditForCheckoutSession detects existing checkout credit", async () => {
    const db = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([{ id: "existing" }]),
          }),
        }),
      }),
    } as unknown as Parameters<typeof hasWalletCreditForCheckoutSession>[0];

    const credited = await hasWalletCreditForCheckoutSession(db, "company-1", "cs_test_123");
    expect(credited).toBe(true);
  });
});
