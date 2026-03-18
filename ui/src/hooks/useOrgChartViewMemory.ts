import { useCallback, useEffect, useMemo, useState } from "react";

export type OrgChartViewport = { pan: { x: number; y: number }; zoom: number };

export type OrgChartViewMemory = {
  version: 1;
  focusedNodeId: string | null;
  expandedNodeIds: string[];
  viewport: OrgChartViewport | null;
};

const DEFAULT_MEMORY: OrgChartViewMemory = {
  version: 1,
  focusedNodeId: null,
  expandedNodeIds: [],
  viewport: null,
};

function storageKey(companyId: string) {
  return `paperclip.orgChartView.v1:${companyId}`;
}

function readMemory(companyId: string): OrgChartViewMemory {
  try {
    const raw = localStorage.getItem(storageKey(companyId));
    if (!raw) return DEFAULT_MEMORY;
    const parsed = JSON.parse(raw) as Partial<OrgChartViewMemory> | null;
    if (!parsed || parsed.version !== 1) return DEFAULT_MEMORY;
    return {
      version: 1,
      focusedNodeId: typeof parsed.focusedNodeId === "string" ? parsed.focusedNodeId : null,
      expandedNodeIds: Array.isArray(parsed.expandedNodeIds)
        ? parsed.expandedNodeIds.filter((x): x is string => typeof x === "string")
        : [],
      viewport:
        parsed.viewport &&
        typeof parsed.viewport === "object" &&
        typeof (parsed.viewport as any).zoom === "number" &&
        (parsed.viewport as any).pan &&
        typeof (parsed.viewport as any).pan.x === "number" &&
        typeof (parsed.viewport as any).pan.y === "number"
          ? { zoom: (parsed.viewport as any).zoom, pan: { x: (parsed.viewport as any).pan.x, y: (parsed.viewport as any).pan.y } }
          : null,
    };
  } catch {
    return DEFAULT_MEMORY;
  }
}

function writeMemory(companyId: string, memory: OrgChartViewMemory) {
  try {
    localStorage.setItem(storageKey(companyId), JSON.stringify(memory));
  } catch {
    // ignore
  }
}

export function useOrgChartViewMemory(companyId: string | null) {
  const [memory, setMemory] = useState<OrgChartViewMemory>(() => (companyId ? readMemory(companyId) : DEFAULT_MEMORY));

  // Reload when company changes
  useEffect(() => {
    if (!companyId) return;
    setMemory(readMemory(companyId));
  }, [companyId]);

  // Persist on change
  useEffect(() => {
    if (!companyId) return;
    writeMemory(companyId, memory);
  }, [companyId, memory]);

  const expandedSet = useMemo(() => new Set(memory.expandedNodeIds), [memory.expandedNodeIds]);

  const setFocusedNodeId = useCallback((focusedNodeId: string | null) => {
    setMemory((prev) => ({ ...prev, focusedNodeId }));
  }, []);

  const setExpandedNodeIds = useCallback((expandedNodeIds: string[]) => {
    setMemory((prev) => ({ ...prev, expandedNodeIds }));
  }, []);

  const toggleExpanded = useCallback((nodeId: string, next?: boolean) => {
    setMemory((prev) => {
      const set = new Set(prev.expandedNodeIds);
      const shouldExpand = next ?? !set.has(nodeId);
      if (shouldExpand) set.add(nodeId);
      else set.delete(nodeId);
      return { ...prev, expandedNodeIds: Array.from(set) };
    });
  }, []);

  const setViewport = useCallback((viewport: OrgChartViewport | null) => {
    setMemory((prev) => ({ ...prev, viewport }));
  }, []);

  return {
    memory,
    setMemory,
    expandedSet,
    setFocusedNodeId,
    setExpandedNodeIds,
    toggleExpanded,
    setViewport,
  };
}

