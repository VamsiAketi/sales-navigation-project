import { z } from "zod";
import {
  SALES_NAV_CONTACT_LEVELS,
  SALES_NAV_CONTACT_STATUSES,
  SALES_NAV_EDGE_TYPES,
} from "../types/sales-navigation.js";

const accountSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  priorityScore: z.number().min(0).max(100).default(0),
  intentScore: z.number().min(0).max(100).default(0),
  ownerLabel: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

const contactSchema = z.object({
  id: z.string().min(1),
  accountId: z.string().min(1),
  name: z.string().min(1),
  title: z.string().nullable().optional(),
  company: z.string().nullable().optional(),
  linkedinUrl: z.string().nullable().optional(),
  level: z.enum(SALES_NAV_CONTACT_LEVELS),
  status: z.enum(SALES_NAV_CONTACT_STATUSES).default("unverified"),
  relationshipStrength: z.number().min(0).max(100).default(0),
  verified: z.boolean().default(false),
  outreachNotes: z.string().nullable().optional(),
  warmIntroPath: z.string().nullable().optional(),
  reportsToContactId: z.string().nullable().optional(),
  teamOwner: z.string().nullable().optional(),
});

const edgeSchema = z.object({
  id: z.string().min(1),
  fromContactId: z.string().min(1),
  toContactId: z.string().min(1),
  type: z.enum(SALES_NAV_EDGE_TYPES),
  strength: z.number().min(0).max(100).default(50),
  label: z.string().nullable().optional(),
});

const outreachSchema = z.object({
  id: z.string().min(1),
  contactId: z.string().min(1),
  at: z.string().min(1),
  summary: z.string().min(1),
});

export const salesNavGraphSchema = z.object({
  accounts: z.array(accountSchema),
  contacts: z.array(contactSchema),
  edges: z.array(edgeSchema),
  outreachHistory: z.array(outreachSchema).default([]),
});

export const importSalesNavSchema = z.object({
  sourceFileName: z.string().min(1).max(512),
  graph: salesNavGraphSchema,
});

export const updateSalesNavContactSchema = z.object({
  status: z.enum(SALES_NAV_CONTACT_STATUSES).optional(),
  verified: z.boolean().optional(),
  outreachNotes: z.string().max(8000).nullable().optional(),
  relationshipStrength: z.number().min(0).max(100).optional(),
});
