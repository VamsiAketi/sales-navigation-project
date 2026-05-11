import { Router, type Request } from "express";
import Stripe from "stripe";
import { stripeCheckoutIntents, type Db } from "@paperclipai/db";
import {
  createCostEventSchema,
  createFinanceEventSchema,
  createStripeCheckoutSessionSchema,
  resolveBudgetIncidentSchema,
  updateBudgetSchema,
  upsertBudgetPolicySchema,
} from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { desc, eq } from "drizzle-orm";
import {
  accessService,
  budgetService,
  costService,
  financeService,
  companyService,
  agentService,
  heartbeatService,
  logActivity,
} from "../services/index.js";
import { assertBoard, assertCompanyAccess, getActorInfo, projectAuthActorFromRequest } from "./authz.js";
import { badRequest, forbidden } from "../errors.js";
import { fetchAllQuotaWindows } from "../services/quota-windows.js";
import { getStripeFromConfig } from "../stripe-client.js";
import {
  createCheckoutIntentRecord,
  findStripeCustomerByCompanyId,
  getCompanyWalletTotals,
  getOrCreateStripeCustomerForCompany,
  hasWalletCreditForCheckoutSession,
  markCheckoutIntentLifecycle,
  stripeBillingBrandingFromEnv,
  stripeSecretsFromEnv,
} from "../services/stripe-billing.js";

export function costRoutes(db: Db) {
  const router = Router();
  const heartbeat = heartbeatService(db);
  const budgetHooks = {
    cancelWorkForScope: heartbeat.cancelBudgetScopeWork,
  };
  const costs = costService(db, budgetHooks);
  const finance = financeService(db);
  const budgets = budgetService(db, budgetHooks);
  const companies = companyService(db);
  const access = accessService(db);
  const agents = agentService(db);

  function mapStripeInvoice(inv: Stripe.Invoice) {
    const line0 = inv.lines?.data?.[0];
    const lineDesc =
      line0 && typeof line0 === "object" && line0 !== null && "description" in line0
        ? String((line0 as { description?: string | null }).description ?? "").trim()
        : "";
    const description =
      inv.description?.trim() || lineDesc || (inv.number?.trim() ? `Invoice ${inv.number.trim()}` : null);
    return {
      id: inv.id,
      number: inv.number ?? null,
      description,
      status: inv.status ?? null,
      amountPaidCents: inv.amount_paid ?? 0,
      currency: inv.currency ?? "usd",
      createdAt: inv.created ? new Date(inv.created * 1000).toISOString() : new Date().toISOString(),
      hostedInvoiceUrl: inv.hosted_invoice_url ?? null,
      invoicePdf: inv.invoice_pdf ?? null,
    };
  }

  async function fetchInvoicesFromRecentCheckoutIntents(stripe: Stripe, companyId: string) {
    const intents = await db
      .select({
        checkoutSessionId: stripeCheckoutIntents.checkoutSessionId,
      })
      .from(stripeCheckoutIntents)
      .where(eq(stripeCheckoutIntents.companyId, companyId))
      .orderBy(desc(stripeCheckoutIntents.createdAt))
      .limit(25);

    const invoices: Stripe.Invoice[] = [];
    const seenInvoiceIds = new Set<string>();
    for (const intent of intents) {
      try {
        const session = await stripe.checkout.sessions.retrieve(intent.checkoutSessionId, {
          expand: ["invoice"],
        });
        let invoice: Stripe.Invoice | null = null;
        if (typeof session.invoice === "string") {
          invoice = await stripe.invoices.retrieve(session.invoice);
        } else if (session.invoice && typeof session.invoice === "object" && "id" in session.invoice) {
          invoice = session.invoice as Stripe.Invoice;
        }
        if (!invoice || seenInvoiceIds.has(invoice.id)) continue;
        seenInvoiceIds.add(invoice.id);
        invoices.push(invoice);
      } catch {
        // Ignore stale/missing checkout sessions so one bad intent doesn't fail the whole invoices API.
        continue;
      }
    }

    return invoices.map(mapStripeInvoice);
  }

  async function assertCostsReadAccess(req: Request, companyId: string) {
    assertCompanyAccess(req, companyId);
    if (req.actor.type === "board") {
      if (req.actor.source === "local_implicit" || req.actor.isInstanceAdmin) return;
      const allowed = await access.canUser(companyId, req.actor.userId, "costs.read");
      if (!allowed) throw forbidden("Missing permission: costs.read");
      return;
    }
    if (!req.actor.agentId) throw forbidden("Agent authentication required");
    const allowed = await access.hasPermission(companyId, "agent", req.actor.agentId, "costs.read");
    if (!allowed) throw forbidden("Missing permission: costs.read");
  }

  router.post("/companies/:companyId/cost-events", validate(createCostEventSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);

    if (req.actor.type === "agent" && req.actor.agentId !== req.body.agentId) {
      res.status(403).json({ error: "Agent can only report its own costs" });
      return;
    }

    const event = await costs.createEvent(companyId, {
      ...req.body,
      occurredAt: new Date(req.body.occurredAt),
    });

    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      action: "cost.reported",
      entityType: "cost_event",
      entityId: event.id,
      details: { costCents: event.costCents, modelCostCents: event.modelCostCents, model: event.model },
    });

    res.status(201).json(event);
  });

  router.post("/companies/:companyId/finance-events", validate(createFinanceEventSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    assertBoard(req);

    const event = await finance.createEvent(companyId, {
      ...req.body,
      occurredAt: new Date(req.body.occurredAt),
    });

    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      action: "finance_event.reported",
      entityType: "finance_event",
      entityId: event.id,
      details: {
        amountCents: event.amountCents,
        biller: event.biller,
        eventKind: event.eventKind,
        direction: event.direction,
      },
    });

    res.status(201).json(event);
  });

  function parseDateRange(query: Record<string, unknown>) {
    const fromRaw = query.from as string | undefined;
    const toRaw = query.to as string | undefined;
    const from = fromRaw ? new Date(fromRaw) : undefined;
    const to = toRaw ? new Date(toRaw) : undefined;
    if (from && isNaN(from.getTime())) throw badRequest("invalid 'from' date");
    if (to && isNaN(to.getTime())) throw badRequest("invalid 'to' date");
    return (from || to) ? { from, to } : undefined;
  }

  function parseLimit(query: Record<string, unknown>) {
    const raw = Array.isArray(query.limit) ? query.limit[0] : query.limit;
    if (raw == null || raw === "") return 100;
    const limit = typeof raw === "number" ? raw : Number.parseInt(String(raw), 10);
    if (!Number.isFinite(limit) || limit <= 0 || limit > 500) {
      throw badRequest("invalid 'limit' value");
    }
    return limit;
  }

  router.get("/companies/:companyId/costs/summary", async (req, res) => {
    const companyId = req.params.companyId as string;
    await assertCostsReadAccess(req, companyId);
    const range = parseDateRange(req.query);
    const summary = await costs.summary(companyId, range);
    res.json(summary);
  });

  router.get("/companies/:companyId/billing/prepaid-balance", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    await assertCostsReadAccess(req, companyId);
    const wallet = await getCompanyWalletTotals(db, companyId);
    const prepaidCents = wallet.creditCents;
    const usedModelCents = wallet.debitCents;
    const net = wallet.netCents;
    const remainingCents = Math.max(0, net);
    const deficitCents = net < 0 ? Math.abs(net) : 0;
    res.json({ prepaidCents, usedModelCents, remainingCents, deficitCents });
  });

  router.get("/companies/:companyId/billing/stripe-status", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    assertBoard(req);
    const { stripeSecretKey, stripeWebhookSecret } = stripeSecretsFromEnv();
    res.json({
      enabled: Boolean(stripeSecretKey),
      hasWebhookSecret: Boolean(stripeWebhookSecret),
    });
  });

  router.get("/companies/:companyId/billing/stripe/invoices", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    assertBoard(req);
    const { stripeSecretKey } = stripeSecretsFromEnv();
    const stripe = getStripeFromConfig({ stripeSecretKey });
    if (!stripe) {
      res.json({ invoices: [] });
      return;
    }
    const customer = await findStripeCustomerByCompanyId(db, stripe, companyId);
    if (!customer) {
      const fallbackInvoices = await fetchInvoicesFromRecentCheckoutIntents(stripe, companyId);
      res.json({ invoices: fallbackInvoices });
      return;
    }
    const list = await stripe.invoices.list({ customer: customer.id, limit: 100 });
    const invoices = list.data.map(mapStripeInvoice);
    if (invoices.length > 0) {
      res.json({ invoices });
      return;
    }
    const fallbackInvoices = await fetchInvoicesFromRecentCheckoutIntents(stripe, companyId);
    res.json({ invoices: fallbackInvoices });
  });
  
  router.post("/companies/:companyId/billing/stripe/portal-session", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    assertBoard(req);
    const { stripeSecretKey } = stripeSecretsFromEnv();
    const stripe = getStripeFromConfig({ stripeSecretKey });
    if (!stripe) {
      res.status(503).json({ error: "Stripe is not configured" });
      return;
    }
    const company = await companies.getById(companyId);
    if (!company) {
      res.status(404).json({ error: "Company not found" });
      return;
    }
    const branding = stripeBillingBrandingFromEnv();
    const customer = await getOrCreateStripeCustomerForCompany({
      db,
      stripe,
      companyId,
      companyName: branding.businessName,
      companyDescription: branding.businessDescription,
    });
    const returnPath = typeof req.body?.returnPath === "string" && req.body.returnPath.startsWith("/")
      ? req.body.returnPath
      : "/company/billing";
    const returnUrl = `${req.protocol}://${req.get("host")}${returnPath}`;
    const session = await stripe.billingPortal.sessions.create({
      customer: customer.id,
      return_url: returnUrl,
    });
    res.json({ url: session.url });
  });

  router.post(
    "/companies/:companyId/billing/stripe/checkout-session",
    validate(createStripeCheckoutSessionSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      assertBoard(req);
      const { stripeSecretKey } = stripeSecretsFromEnv();
      const stripe = getStripeFromConfig({ stripeSecretKey });
      if (!stripe) {
        res.status(503).json({ error: "Stripe is not configured" });
        return;
      }
      const company = await companies.getById(companyId);
      if (!company) {
        res.status(404).json({ error: "Company not found" });
        return;
      }
      const branding = stripeBillingBrandingFromEnv();
      const customer = await getOrCreateStripeCustomerForCompany({
        db,
        stripe,
        companyId,
        companyName: branding.businessName,
        companyDescription: branding.businessDescription,
      });
      const baseUrl = `${req.protocol}://${req.get("host")}`;
      const returnPath = req.body.returnPath?.startsWith("/") ? req.body.returnPath : "/company/billing";
      const successUrl = `${baseUrl}${returnPath}?stripe=payment-success&session_id={CHECKOUT_SESSION_ID}`;
      const cancelUrl = `${baseUrl}${returnPath}?stripe=payment-cancelled`;
      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        customer: customer.id,
        success_url: successUrl,
        cancel_url: cancelUrl,
        payment_method_types: ["card"],
        payment_method_options: {
          card: {
            request_three_d_secure: "automatic",
          },
        },
        // One-time Checkout does not create a Stripe Invoice by default; enable so top-ups show under Invoices / PDF.
        invoice_creation: { enabled: true },
        metadata: {
          paperclip_company_id: companyId,
          paperclip_kind: "prepaid_topup",
        },
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: "usd",
              unit_amount: req.body.amountCents,
              product_data: {
                name: "Wallet funds added",
                description: `Top-up for ${branding.businessName}`,
              },
            },
          },
        ],
      }, req.body.idempotencyKey ? { idempotencyKey: req.body.idempotencyKey } : undefined);
      if (!session.url) {
        res.status(500).json({ error: "Stripe checkout session did not include a redirect URL" });
        return;
      }
      await createCheckoutIntentRecord({
        db,
        companyId,
        checkoutSessionId: session.id,
        amountCents: req.body.amountCents,
        currency: "usd",
        stripeCustomerId: customer.id,
        paymentIntentId: typeof session.payment_intent === "string" ? session.payment_intent : null,
        status: "created",
        metadata: { requestedBy: req.actor.type, idempotencyKey: req.body.idempotencyKey ?? null },
      });
      res.json({
        sessionId: session.id,
        url: session.url,
      });
    },
  );

  router.get("/companies/:companyId/billing/stripe/checkout-session/:sessionId/status", async (req, res) => {
    const companyId = req.params.companyId as string;
    const sessionId = req.params.sessionId as string;
    assertCompanyAccess(req, companyId);
    assertBoard(req);
    const { stripeSecretKey } = stripeSecretsFromEnv();
    const stripe = getStripeFromConfig({ stripeSecretKey });
    if (!stripe) {
      res.status(503).json({ error: "Stripe is not configured" });
      return;
    }
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    const sessionCompanyId = session.metadata?.paperclip_company_id?.trim();
    if (!sessionCompanyId || sessionCompanyId !== companyId) {
      res.status(404).json({ error: "Checkout session not found" });
      return;
    }
    const credited = await hasWalletCreditForCheckoutSession(db, companyId, sessionId);
    const paid = session.payment_status === "paid" && credited;
    if (paid) {
      await markCheckoutIntentLifecycle(db, sessionId, "reconciled");
    } else if (session.payment_status === "paid") {
      await markCheckoutIntentLifecycle(db, sessionId, "paid");
    } else {
      await markCheckoutIntentLifecycle(db, sessionId, "failed");
    }
    res.json({
      sessionId,
      status: paid ? "paid" : "unpaid",
      paymentStatus: session.payment_status ?? null,
    });
  });

  router.get("/companies/:companyId/costs/daily", async (req, res) => {
    const companyId = req.params.companyId as string;
    await assertCostsReadAccess(req, companyId);
    const range = parseDateRange(req.query);
    if (!range?.from || !range?.to) {
      res.status(400).json({ error: "Query parameters 'from' and 'to' are required (ISO dates)." });
      return;
    }
    const rows = await costs.dailyTotals(companyId, range);
    res.json(rows);
  });

  router.get("/companies/:companyId/costs/by-agent", async (req, res) => {
    const companyId = req.params.companyId as string;
    await assertCostsReadAccess(req, companyId);
    const range = parseDateRange(req.query);
    const rows = await costs.byAgent(companyId, range);
    res.json(rows);
  });

  router.get("/companies/:companyId/costs/by-agent-model", async (req, res) => {
    const companyId = req.params.companyId as string;
    await assertCostsReadAccess(req, companyId);
    const range = parseDateRange(req.query);
    const rows = await costs.byAgentModel(companyId, range);
    res.json(rows);
  });

  router.get("/companies/:companyId/costs/by-provider", async (req, res) => {
    const companyId = req.params.companyId as string;
    await assertCostsReadAccess(req, companyId);
    const range = parseDateRange(req.query);
    const rows = await costs.byProvider(companyId, range);
    res.json(rows);
  });

  router.get("/companies/:companyId/costs/by-biller", async (req, res) => {
    const companyId = req.params.companyId as string;
    await assertCostsReadAccess(req, companyId);
    const range = parseDateRange(req.query);
    const rows = await costs.byBiller(companyId, range);
    res.json(rows);
  });

  router.get("/companies/:companyId/costs/finance-summary", async (req, res) => {
    const companyId = req.params.companyId as string;
    await assertCostsReadAccess(req, companyId);
    const range = parseDateRange(req.query);
    const summary = await finance.summary(companyId, range);
    res.json(summary);
  });

  router.get("/companies/:companyId/costs/finance-by-biller", async (req, res) => {
    const companyId = req.params.companyId as string;
    await assertCostsReadAccess(req, companyId);
    const range = parseDateRange(req.query);
    const rows = await finance.byBiller(companyId, range);
    res.json(rows);
  });

  router.get("/companies/:companyId/costs/finance-by-kind", async (req, res) => {
    const companyId = req.params.companyId as string;
    await assertCostsReadAccess(req, companyId);
    const range = parseDateRange(req.query);
    const rows = await finance.byKind(companyId, range);
    res.json(rows);
  });

  router.get("/companies/:companyId/costs/finance-events", async (req, res) => {
    const companyId = req.params.companyId as string;
    await assertCostsReadAccess(req, companyId);
    const range = parseDateRange(req.query);
    const limit = parseLimit(req.query);
    const rows = await finance.list(companyId, range, limit);
    res.json(rows);
  });

  router.get("/companies/:companyId/costs/window-spend", async (req, res) => {
    const companyId = req.params.companyId as string;
    await assertCostsReadAccess(req, companyId);
    const rows = await costs.windowSpend(companyId);
    res.json(rows);
  });

  router.get("/companies/:companyId/costs/quota-windows", async (req, res) => {
    const companyId = req.params.companyId as string;
    await assertCostsReadAccess(req, companyId);
    assertBoard(req);
    // validate companyId resolves to a real company so the "__none__" sentinel
    // and any forged ids are rejected before we touch provider credentials
    const company = await companies.getById(companyId);
    if (!company) {
      res.status(404).json({ error: "Company not found" });
      return;
    }
    const results = await fetchAllQuotaWindows();
    res.json(results);
  });

  router.get("/companies/:companyId/budgets/overview", async (req, res) => {
    const companyId = req.params.companyId as string;
    await assertCostsReadAccess(req, companyId);
    const overview = await budgets.overview(companyId);
    res.json(overview);
  });

  router.post(
    "/companies/:companyId/budgets/policies",
    validate(upsertBudgetPolicySchema),
    async (req, res) => {
      assertBoard(req);
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const summary = await budgets.upsertPolicy(companyId, req.body, req.actor.userId ?? "board");
      res.json(summary);
    },
  );

  router.post(
    "/companies/:companyId/budget-incidents/:incidentId/resolve",
    validate(resolveBudgetIncidentSchema),
    async (req, res) => {
      assertBoard(req);
      const companyId = req.params.companyId as string;
      const incidentId = req.params.incidentId as string;
      assertCompanyAccess(req, companyId);
      const incident = await budgets.resolveIncident(companyId, incidentId, req.body, req.actor.userId ?? "board");
      res.json(incident);
    },
  );

  router.get("/companies/:companyId/costs/by-project", async (req, res) => {
    const companyId = req.params.companyId as string;
    await assertCostsReadAccess(req, companyId);
    const range = parseDateRange(req.query);
    const rows = await costs.byProject(companyId, range);
    const actor = projectAuthActorFromRequest(req);
    const allowedIds = await access.listProjectIdsVisibleToActor(companyId, actor);
    if (allowedIds !== null) {
      const allow = new Set(allowedIds);
      res.json(rows.filter((row) => row.projectId != null && allow.has(row.projectId)));
      return;
    }
    res.json(rows);
  });

  router.patch("/companies/:companyId/budgets", validate(updateBudgetSchema), async (req, res) => {
    assertBoard(req);
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    if (await access.companyUsesRestrictedProjectAccess(companyId)) {
      const uid = req.actor.type === "board" ? req.actor.userId : undefined;
      const manage =
        uid && (await access.canUser(companyId, uid, "users:manage_permissions"));
      const viaProject = await access.principalHasAnyProjectPermission(
        companyId,
        projectAuthActorFromRequest(req),
        "project:edit Budget",
      );
      if (!manage && !viaProject) {
        throw forbidden("Permission denied");
      }
    }
    const company = await companies.update(companyId, { budgetMonthlyCents: req.body.budgetMonthlyCents });
    if (!company) {
      res.status(404).json({ error: "Company not found" });
      return;
    }

    await logActivity(db, {
      companyId,
      actorType: "user",
      actorId: req.actor.userId ?? "board",
      action: "company.budget_updated",
      entityType: "company",
      entityId: companyId,
      details: { budgetMonthlyCents: req.body.budgetMonthlyCents },
    });

    await budgets.upsertPolicy(
      companyId,
      {
        scopeType: "company",
        scopeId: companyId,
        amount: req.body.budgetMonthlyCents,
        windowKind: "calendar_month_utc",
      },
      req.actor.userId ?? "board",
    );

    res.json(company);
  });

  router.patch("/agents/:agentId/budgets", validate(updateBudgetSchema), async (req, res) => {
    const agentId = req.params.agentId as string;
    const agent = await agents.getById(agentId);
    if (!agent) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }

    assertCompanyAccess(req, agent.companyId);

    if (req.actor.type === "agent") {
      if (req.actor.agentId !== agentId) {
        res.status(403).json({ error: "Agent can only change its own budget" });
        return;
      }
    }

    const updated = await agents.update(agentId, { budgetMonthlyCents: req.body.budgetMonthlyCents });
    if (!updated) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }

    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId: updated.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      action: "agent.budget_updated",
      entityType: "agent",
      entityId: updated.id,
      details: { budgetMonthlyCents: updated.budgetMonthlyCents },
    });

    await budgets.upsertPolicy(
      updated.companyId,
      {
        scopeType: "agent",
        scopeId: updated.id,
        amount: updated.budgetMonthlyCents,
        windowKind: "calendar_month_utc",
      },
      req.actor.type === "board" ? req.actor.userId ?? "board" : null,
    );

    res.json(updated);
  });

  return router;
}
