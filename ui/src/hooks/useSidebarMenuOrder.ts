import { useCallback, useEffect, useMemo, useState } from "react";
import {
  COMPANY_SIDEBAR_NAV_ORDER_UPDATED,
  PRIMARY_SIDEBAR_NAV_ORDER_UPDATED,
  finalizePrimaryNavOrder,
  getCompanyNavOrderStorageKey,
  getPrimaryNavOrderStorageKey,
  mergeNavOrder,
  readCompanyNavOrder,
  readNavOrderFromStorage,
  readPrimaryNavOrder,
  writeNavOrderToStorage,
} from "../lib/sidebar-menu-order";

function areEqual(a: string[], b: string[]) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

type OrderUpdatedDetail = {
  storageKey: string;
  orderedIds: string[];
};

export function usePrimarySidebarNavOrder(
  companyId: string | null | undefined,
  userId: string | null | undefined,
  availableIds: string[],
) {
  const storageKey = useMemo(() => {
    if (!companyId) return null;
    return getPrimaryNavOrderStorageKey(companyId, userId);
  }, [companyId, userId]);

  const [orderedIds, setOrderedIds] = useState<string[]>(() => {
    const stored = companyId ? readPrimaryNavOrder(companyId, userId) : [];
    const merged = mergeNavOrder(availableIds, stored);
    return finalizePrimaryNavOrder(availableIds, stored, merged);
  });

  useEffect(() => {
    const stored = companyId ? readPrimaryNavOrder(companyId, userId) : [];
    const merged = mergeNavOrder(availableIds, stored);
    const next = finalizePrimaryNavOrder(availableIds, stored, merged);
    if (storageKey && !areEqual(next, merged)) {
      writeNavOrderToStorage(storageKey, next, PRIMARY_SIDEBAR_NAV_ORDER_UPDATED);
    }
    setOrderedIds((current) => (areEqual(current, next) ? current : next));
  }, [availableIds, companyId, storageKey, userId]);

  useEffect(() => {
    if (!storageKey) return;

    const sync = (ids: string[]) => {
      const merged = mergeNavOrder(availableIds, ids);
      const next = finalizePrimaryNavOrder(availableIds, ids, merged);
      setOrderedIds((current) => (areEqual(current, next) ? current : next));
    };

    const onStorage = (event: StorageEvent) => {
      if (event.key !== storageKey) return;
      sync(readNavOrderFromStorage(storageKey));
    };
    const onCustom = (event: Event) => {
      const detail = (event as CustomEvent<OrderUpdatedDetail>).detail;
      if (!detail || detail.storageKey !== storageKey) return;
      sync(detail.orderedIds);
    };

    window.addEventListener("storage", onStorage);
    window.addEventListener(PRIMARY_SIDEBAR_NAV_ORDER_UPDATED, onCustom);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(PRIMARY_SIDEBAR_NAV_ORDER_UPDATED, onCustom);
    };
  }, [availableIds, storageKey, userId]);

  const persistOrder = useCallback(
    (ids: string[]) => {
      const avail = new Set(availableIds);
      const filtered = ids.filter((id) => avail.has(id));
      for (const id of availableIds) {
        if (!filtered.includes(id)) filtered.push(id);
      }
      setOrderedIds((current) => (areEqual(current, filtered) ? current : filtered));
      if (storageKey) {
        writeNavOrderToStorage(storageKey, filtered, PRIMARY_SIDEBAR_NAV_ORDER_UPDATED);
      }
    },
    [availableIds, storageKey],
  );

  return { orderedIds, persistOrder };
}

export function useCompanySidebarNavOrder(
  companyId: string | null | undefined,
  userId: string | null | undefined,
  availableIds: string[],
) {
  const storageKey = useMemo(() => {
    if (!companyId) return null;
    return getCompanyNavOrderStorageKey(companyId, userId);
  }, [companyId, userId]);

  const [orderedIds, setOrderedIds] = useState<string[]>(() =>
    mergeNavOrder(availableIds, companyId ? readCompanyNavOrder(companyId, userId) : []),
  );

  useEffect(() => {
    const next = mergeNavOrder(
      availableIds,
      companyId ? readCompanyNavOrder(companyId, userId) : [],
    );
    setOrderedIds((current) => (areEqual(current, next) ? current : next));
  }, [availableIds, companyId, userId]);

  useEffect(() => {
    if (!storageKey) return;

    const sync = (ids: string[]) => {
      const next = mergeNavOrder(availableIds, ids);
      setOrderedIds((current) => (areEqual(current, next) ? current : next));
    };

    const onStorage = (event: StorageEvent) => {
      if (event.key !== storageKey) return;
      sync(readNavOrderFromStorage(storageKey));
    };
    const onCustom = (event: Event) => {
      const detail = (event as CustomEvent<OrderUpdatedDetail>).detail;
      if (!detail || detail.storageKey !== storageKey) return;
      sync(detail.orderedIds);
    };

    window.addEventListener("storage", onStorage);
    window.addEventListener(COMPANY_SIDEBAR_NAV_ORDER_UPDATED, onCustom);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(COMPANY_SIDEBAR_NAV_ORDER_UPDATED, onCustom);
    };
  }, [availableIds, storageKey, userId]);

  const persistOrder = useCallback(
    (ids: string[]) => {
      const avail = new Set(availableIds);
      const filtered = ids.filter((id) => avail.has(id));
      for (const id of availableIds) {
        if (!filtered.includes(id)) filtered.push(id);
      }
      setOrderedIds((current) => (areEqual(current, filtered) ? current : filtered));
      if (storageKey) {
        writeNavOrderToStorage(storageKey, filtered, COMPANY_SIDEBAR_NAV_ORDER_UPDATED);
      }
    },
    [availableIds, storageKey],
  );

  return { orderedIds, persistOrder };
}
