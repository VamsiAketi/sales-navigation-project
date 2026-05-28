import type { SalesNavGraph } from "@paperclipai/shared";

/** Direct neighbors in the mutual-routes row (internal_champion) for the selected contact. */
export function salesNavMiddleRowConnectionIds(
  graph: SalesNavGraph,
  accountId: string,
  selectedContactId: string | null,
): Set<string> {
  if (!selectedContactId) return new Set();

  const contactById = new Map(
    graph.contacts.filter((contact) => contact.accountId === accountId).map((contact) => [contact.id, contact]),
  );

  const highlighted = new Set<string>();
  for (const edge of graph.edges) {
    const otherId =
      edge.fromContactId === selectedContactId
        ? edge.toContactId
        : edge.toContactId === selectedContactId
          ? edge.fromContactId
          : null;
    if (!otherId) continue;
    const other = contactById.get(otherId);
    if (other?.level === "internal_champion") {
      highlighted.add(otherId);
    }
  }

  return highlighted;
}

export function salesNavIsMiddleRowConnectionEdge(
  fromContactId: string,
  toContactId: string,
  selectedContactId: string | null,
  middleRowConnectionIds: Set<string>,
): boolean {
  if (!selectedContactId || middleRowConnectionIds.size === 0) return false;
  return (
    (fromContactId === selectedContactId && middleRowConnectionIds.has(toContactId)) ||
    (toContactId === selectedContactId && middleRowConnectionIds.has(fromContactId))
  );
}
