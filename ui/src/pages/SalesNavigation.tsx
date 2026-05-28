import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SalesNavContactStatus } from "@paperclipai/shared";
import { findOptimalRoute, listRouteTargets } from "@paperclipai/shared";
import { salesNavigationApi } from "../api/salesNavigation";
import { sidebarBadgesApi } from "../api/sidebarBadges";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { parseSalesNavExcelBuffer } from "../lib/sales-navigation/parse-excel";
import { clearSalesNavNodeLayouts } from "../lib/sales-navigation/node-layout-storage";
import { BattleMapGraph } from "../components/sales-navigation/BattleMapGraph";
import { SalesNavRightSidebar } from "../components/sales-navigation/SalesNavRightSidebar";
import { SalesNavImportTemplateRef } from "../components/sales-navigation/SalesNavImportTemplateRef";
import { SalesNavPageToolbar } from "../components/sales-navigation/SalesNavPageToolbar";
import { cn } from "@/lib/utils";

export function SalesNavigation() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);
  const [routeTargetId, setRouteTargetId] = useState<string | null>(null);
  const [intelPanelOpen, setIntelPanelOpen] = useState(false);

  useEffect(() => {
    setBreadcrumbs([{ label: "Sales Navigation" }]);
  }, [setBreadcrumbs]);

  const { data: sidebarBadges } = useQuery({
    queryKey: selectedCompanyId ? queryKeys.sidebarBadges(selectedCompanyId) : ["sidebar-badges", "none"],
    queryFn: () => sidebarBadgesApi.get(selectedCompanyId!),
    enabled: Boolean(selectedCompanyId),
    staleTime: 10_000,
  });
  const canRead = sidebarBadges?.canReadGoals ?? true;
  const canWrite = sidebarBadges?.canWriteGoals ?? true;

  const { data: state, isLoading, error } = useQuery({
    queryKey: selectedCompanyId ? queryKeys.salesNavigation(selectedCompanyId) : ["sales-navigation", "none"],
    queryFn: () => salesNavigationApi.get(selectedCompanyId!),
    enabled: Boolean(selectedCompanyId && canRead),
  });

  const hasImportedData = Boolean(state?.graph.contacts.length);

  useEffect(() => {
    if (!state?.graph.accounts.length) return;
    setSelectedAccountId((prev) => prev ?? state.insights.nextBestAccountId ?? state.graph.accounts[0]?.id ?? null);
    setSelectedContactId((prev) => prev ?? state.insights.recommendedContactId ?? null);
  }, [state]);

  const routeTargets = useMemo(() => {
    if (!state || !selectedAccountId) return [];
    return listRouteTargets(state.graph, selectedAccountId);
  }, [state, selectedAccountId]);

  useEffect(() => {
    if (routeTargets.length === 0) {
      setRouteTargetId(null);
      return;
    }
    setRouteTargetId((prev) =>
      prev && routeTargets.some((t) => t.id === prev) ? prev : (routeTargets[0]?.id ?? null),
    );
  }, [selectedAccountId, routeTargets]);

  const optimalRoute = useMemo(() => {
    if (!state || !selectedAccountId) return null;
    return findOptimalRoute(state.graph, selectedAccountId, routeTargetId);
  }, [state, selectedAccountId, routeTargetId]);

  const importMutation = useMutation({
    mutationFn: async (file: File) => {
      await salesNavigationApi.clear(selectedCompanyId!);
      const buffer = await file.arrayBuffer();
      const graph = parseSalesNavExcelBuffer(buffer);
      return salesNavigationApi.import(selectedCompanyId!, file.name, graph);
    },
    onSuccess: (next) => {
      if (selectedCompanyId) clearSalesNavNodeLayouts(selectedCompanyId);
      queryClient.setQueryData(queryKeys.salesNavigation(selectedCompanyId!), next);
      setSelectedAccountId(next.insights.nextBestAccountId ?? next.graph.accounts[0]?.id ?? null);
      setSelectedContactId(next.insights.recommendedContactId ?? null);
      setIntelPanelOpen(false);
    },
  });

  const statusMutation = useMutation({
    mutationFn: ({ contactId, status }: { contactId: string; status: SalesNavContactStatus }) =>
      salesNavigationApi.updateContact(selectedCompanyId!, contactId, { status }),
    onSuccess: (next) => {
      queryClient.setQueryData(queryKeys.salesNavigation(selectedCompanyId!), next);
    },
  });

  const selectedContact = useMemo(
    () => state?.graph.contacts.find((c) => c.id === selectedContactId) ?? null,
    [state, selectedContactId],
  );
  const selectedAccountName = useMemo(
    () => state?.graph.accounts.find((a) => a.id === selectedAccountId)?.name ?? null,
    [state, selectedAccountId],
  );

  const onFileChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file || !selectedCompanyId) return;
      importMutation.mutate(file);
      event.target.value = "";
    },
    [importMutation, selectedCompanyId],
  );

  const handleSelectContact = useCallback((contactId: string) => {
    setSelectedContactId(contactId);
    setIntelPanelOpen(true);
  }, []);

  const handleSelectAccount = useCallback((accountId: string) => {
    setSelectedAccountId(accountId);
  }, []);

  if (!selectedCompanyId) {
    return <p className="text-sm text-muted-foreground">Select a company to open Sales Navigation.</p>;
  }

  if (!canRead) {
    return (
      <p className="text-sm text-muted-foreground">You do not have permission to view Sales Navigation.</p>
    );
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden">
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xls,.csv"
        className="hidden"
        onChange={onFileChange}
      />

      <SalesNavPageToolbar
        canWrite={canWrite}
        importPending={importMutation.isPending}
        sourceFileName={state?.sourceFileName}
        companyLabel={selectedAccountName}
        showImportHelp={!hasImportedData}
        intelPanelOpen={intelPanelOpen}
        onUpload={() => fileInputRef.current?.click()}
        onToggleIntelPanel={() => setIntelPanelOpen((v) => !v)}
      />

      {!hasImportedData ? <SalesNavImportTemplateRef /> : null}

      {error ? <p className="shrink-0 px-2 py-1 text-sm text-destructive">{(error as Error).message}</p> : null}
      {importMutation.isError ? (
        <p className="shrink-0 px-2 py-1 text-sm text-destructive">{(importMutation.error as Error).message}</p>
      ) : null}
      {statusMutation.isError ? (
        <p className="shrink-0 px-2 py-1 text-sm text-destructive">
          {(statusMutation.error as Error).message || "Failed to update contact status."}
        </p>
      ) : null}

      {isLoading || !state ? (
        <div className="flex flex-1 items-center justify-center bg-muted/10">
          <p className="text-sm text-muted-foreground">Loading battle map…</p>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
          <div
            className={cn(
              "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden",
              intelPanelOpen && "lg:border-r lg:border-border",
            )}
          >
            <BattleMapGraph
              graph={state.graph}
              selectedAccountId={selectedAccountId}
              selectedContactId={selectedContactId}
              recommendedContactId={state.insights.recommendedContactId}
              highlightedPath={optimalRoute}
              routeTargets={routeTargets}
              routeTargetId={routeTargetId}
              onRouteTargetChange={setRouteTargetId}
              onSelectAccount={handleSelectAccount}
              onSelectContact={handleSelectContact}
              compact
            />
          </div>

          {intelPanelOpen ? (
            <aside className="flex max-h-[50%] min-h-0 w-full shrink-0 flex-col border-t border-border bg-card shadow-lg lg:max-h-none lg:w-[min(100%,22rem)] lg:max-w-[22rem] lg:border-t-0 lg:shadow-none xl:w-[24rem] xl:max-w-[24rem]">
              <SalesNavRightSidebar
                graph={state.graph}
                insights={state.insights}
                selectedContact={selectedContact}
                canWrite={canWrite}
                onClose={() => setIntelPanelOpen(false)}
                onStatusChange={(status) => {
                  const contactId = selectedContact?.id ?? selectedContactId;
                  if (!contactId) return;
                  statusMutation.mutate({ contactId, status });
                }}
              />
            </aside>
          ) : null}
        </div>
      )}
    </div>
  );
}
