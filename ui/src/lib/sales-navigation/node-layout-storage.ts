export type SalesNavNodeOffset = { x: number; y: number };

export type SalesNavAccountLayout = {
  offsets: Record<string, SalesNavNodeOffset>;
  zoom?: number;
  scrollLeft?: number;
  scrollTop?: number;
};

type StoredCompanyLayouts = Record<string, SalesNavAccountLayout>;

function storageKey(companyId: string): string {
  return `sales-nav.node-layout.${companyId}`;
}

function readAll(companyId: string): StoredCompanyLayouts {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(storageKey(companyId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as StoredCompanyLayouts;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function normalizeAccountLayout(raw: unknown): SalesNavAccountLayout {
  if (!raw || typeof raw !== "object") return { offsets: {} };
  const record = raw as Record<string, unknown>;
  if (record.offsets && typeof record.offsets === "object" && !Array.isArray(record.offsets)) {
    return {
      offsets: record.offsets as Record<string, SalesNavNodeOffset>,
      zoom: typeof record.zoom === "number" ? record.zoom : undefined,
      scrollLeft: typeof record.scrollLeft === "number" ? record.scrollLeft : undefined,
      scrollTop: typeof record.scrollTop === "number" ? record.scrollTop : undefined,
    };
  }
  return { offsets: record as Record<string, SalesNavNodeOffset> };
}

function filterOffsets(
  offsets: Record<string, SalesNavNodeOffset>,
  validContactIds?: Set<string>,
): Record<string, SalesNavNodeOffset> {
  if (!validContactIds) return offsets;
  const filtered: Record<string, SalesNavNodeOffset> = {};
  for (const [id, offset] of Object.entries(offsets)) {
    if (validContactIds.has(id)) filtered[id] = offset;
  }
  return filtered;
}

export function readSalesNavAccountLayout(
  companyId: string,
  accountId: string,
  validContactIds?: Set<string>,
): SalesNavAccountLayout & { hasCustomLayout: boolean } {
  const stored = normalizeAccountLayout(readAll(companyId)[accountId]);
  const offsets = filterOffsets(stored.offsets, validContactIds);
  return {
    offsets,
    zoom: stored.zoom,
    scrollLeft: stored.scrollLeft,
    scrollTop: stored.scrollTop,
    hasCustomLayout: Object.keys(offsets).length > 0,
  };
}

/** @deprecated Use readSalesNavAccountLayout */
export function readSalesNavNodeLayoutOffsets(
  companyId: string,
  accountId: string,
): Record<string, SalesNavNodeOffset> {
  return readSalesNavAccountLayout(companyId, accountId).offsets;
}

export function writeSalesNavAccountLayout(
  companyId: string,
  accountId: string,
  layout: SalesNavAccountLayout,
): void {
  if (typeof window === "undefined") return;
  try {
    const all = readAll(companyId);
    const offsets = layout.offsets ?? {};
    if (Object.keys(offsets).length === 0 && layout.zoom == null && layout.scrollLeft == null) {
      delete all[accountId];
    } else {
      all[accountId] = {
        offsets,
        ...(layout.zoom != null ? { zoom: layout.zoom } : {}),
        ...(layout.scrollLeft != null ? { scrollLeft: layout.scrollLeft } : {}),
        ...(layout.scrollTop != null ? { scrollTop: layout.scrollTop } : {}),
      };
    }
    localStorage.setItem(storageKey(companyId), JSON.stringify(all));
  } catch {
    /* ignore quota / privacy errors */
  }
}

export function writeSalesNavNodeLayoutOffsets(
  companyId: string,
  accountId: string,
  offsets: Record<string, SalesNavNodeOffset>,
): void {
  const existing = readSalesNavAccountLayout(companyId, accountId);
  writeSalesNavAccountLayout(companyId, accountId, { ...existing, offsets });
}

export function clearSalesNavNodeLayouts(companyId: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(storageKey(companyId));
  } catch {
    /* ignore */
  }
}
