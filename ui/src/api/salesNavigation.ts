import type { SalesNavGraph, SalesNavState } from "@paperclipai/shared";
import { isVercelStaticMode } from "../lib/vercel-static/config";
import { api } from "./client";
import { localSalesNavigationApi } from "./salesNavigation.local";

const remoteSalesNavigationApi = {
  get: (companyId: string) => api.get<SalesNavState>(`/companies/${companyId}/sales-navigation`),
  clear: (companyId: string) => api.delete<SalesNavState>(`/companies/${companyId}/sales-navigation`),
  import: (companyId: string, sourceFileName: string, graph: SalesNavGraph) =>
    api.post<SalesNavState>(`/companies/${companyId}/sales-navigation/import`, {
      sourceFileName,
      graph,
    }),
  updateContact: (
    companyId: string,
    contactId: string,
    patch: {
      status?: string;
      verified?: boolean;
      outreachNotes?: string | null;
      relationshipStrength?: number;
    },
  ) => api.patch<SalesNavState>(`/companies/${companyId}/sales-navigation/contacts/${contactId}`, patch),
};

export const salesNavigationApi = isVercelStaticMode
  ? localSalesNavigationApi
  : remoteSalesNavigationApi;
