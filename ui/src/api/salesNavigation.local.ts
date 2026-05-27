import type { SalesNavGraph, SalesNavState } from "@paperclipai/shared";
import { analyzeSalesNavGraph } from "../lib/sales-navigation/analyze-graph";

const STORAGE_KEY_PREFIX = "sales-nav-state:";

function emptyGraph(): SalesNavGraph {
  return { accounts: [], contacts: [], edges: [], outreachHistory: [] };
}

function emptyState(companyId: string): SalesNavState {
  const graph = emptyGraph();
  return {
    companyId,
    sourceFileName: null,
    importedAt: null,
    graph,
    insights: analyzeSalesNavGraph(graph),
    updatedAt: new Date().toISOString(),
  };
}

function loadState(companyId: string): SalesNavState | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(`${STORAGE_KEY_PREFIX}${companyId}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SalesNavState;
  } catch {
    return null;
  }
}

function saveState(state: SalesNavState): SalesNavState {
  localStorage.setItem(`${STORAGE_KEY_PREFIX}${state.companyId}`, JSON.stringify(state));
  return state;
}

export const localSalesNavigationApi = {
  get: async (companyId: string) => loadState(companyId) ?? emptyState(companyId),

  clear: async (companyId: string) => {
    localStorage.removeItem(`${STORAGE_KEY_PREFIX}${companyId}`);
    return emptyState(companyId);
  },

  import: async (companyId: string, sourceFileName: string, graph: SalesNavGraph) => {
    const state: SalesNavState = {
      companyId,
      sourceFileName,
      importedAt: new Date().toISOString(),
      graph,
      insights: analyzeSalesNavGraph(graph),
      updatedAt: new Date().toISOString(),
    };
    return saveState(state);
  },

  updateContact: async (
    companyId: string,
    contactId: string,
    patch: {
      status?: string;
      verified?: boolean;
      outreachNotes?: string | null;
      relationshipStrength?: number;
    },
  ) => {
    const current = loadState(companyId) ?? emptyState(companyId);
    const graph = structuredClone(current.graph);
    const contact = graph.contacts.find((c) => c.id === contactId);
    if (!contact) throw new Error("Contact not found");
    if (patch.status !== undefined) {
      contact.status = patch.status as typeof contact.status;
    }
    if (patch.verified !== undefined) contact.verified = patch.verified;
    if (patch.outreachNotes !== undefined) contact.outreachNotes = patch.outreachNotes;
    if (patch.relationshipStrength !== undefined) {
      contact.relationshipStrength = patch.relationshipStrength;
    }
    return localSalesNavigationApi.import(
      companyId,
      current.sourceFileName ?? "updated",
      graph,
    );
  },
};
