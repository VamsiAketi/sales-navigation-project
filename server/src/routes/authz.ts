import type { Request } from "express";
import type { ProjectAuthActor } from "@paperclipai/shared";
import { forbidden, unauthorized } from "../errors.js";

export function assertBoard(req: Request) {
  if (req.actor.type !== "board") {
    throw forbidden("Board access required");
  }
}

export function assertInstanceAdmin(req: Request) {
  assertBoard(req);
  if (req.actor.source === "local_implicit" || req.actor.isInstanceAdmin) {
    return;
  }
  throw forbidden("Instance admin access required");
}

export function assertCompanyAccess(req: Request, companyId: string) {
  if (req.actor.type === "none") {
    throw unauthorized();
  }
  if (req.actor.type === "agent" && req.actor.companyId !== companyId) {
    throw forbidden("Agent key cannot access another company");
  }
  if (req.actor.type === "board" && req.actor.source !== "local_implicit" && !req.actor.isInstanceAdmin) {
    const allowedCompanies = req.actor.companyIds ?? [];
    if (!allowedCompanies.includes(companyId)) {
      throw forbidden("User does not have access to this company");
    }
  }
}

export function projectAuthActorFromRequest(req: Request): ProjectAuthActor {
  if (req.actor.type === "none") return { kind: "none" };
  if (req.actor.type === "board" && req.actor.source === "local_implicit") {
    return { kind: "local_implicit_board" };
  }
  if (req.actor.type === "board") {
    return {
      kind: "user",
      userId: req.actor.userId ?? "",
      isInstanceAdmin: Boolean(req.actor.isInstanceAdmin),
    };
  }
  if (req.actor.type === "agent" && req.actor.agentId) {
    return { kind: "agent", agentId: req.actor.agentId };
  }
  return { kind: "none" };
}

export function getActorInfo(req: Request) {
  if (req.actor.type === "none") {
    throw unauthorized();
  }
  if (req.actor.type === "agent") {
    return {
      actorType: "agent" as const,
      actorId: req.actor.agentId ?? "unknown-agent",
      agentId: req.actor.agentId ?? null,
      runId: req.actor.runId ?? null,
    };
  }

  return {
    actorType: "user" as const,
    actorId: req.actor.userId ?? "board",
    agentId: null,
    runId: req.actor.runId ?? null,
  };
}
