export const goalListColumns = ["name", "status", "level", "parent", "projects", "created"] as const;
export type GoalListColumn = (typeof goalListColumns)[number];

export const DEFAULT_GOAL_LIST_COLUMNS: GoalListColumn[] = [...goalListColumns];

export const GOAL_LIST_COLUMNS_STORAGE_KEY = "paperclip:goals-list-columns:v2";

export const goalListColumnLabels: Record<GoalListColumn, string> = {
  name: "Name",
  status: "Status",
  level: "Level",
  parent: "Parent goal",
  projects: "Projects",
  created: "Created date",
};

export function normalizeGoalListColumns(columns: Iterable<string | GoalListColumn>): GoalListColumn[] {
  const selected = new Set(columns);
  return goalListColumns.filter((column) => selected.has(column));
}

export function loadGoalListColumns(): GoalListColumn[] {
  try {
    const raw = localStorage.getItem(GOAL_LIST_COLUMNS_STORAGE_KEY);
    if (raw === null) return DEFAULT_GOAL_LIST_COLUMNS;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_GOAL_LIST_COLUMNS;
    const normalized = normalizeGoalListColumns(parsed);
    return normalized.length > 0 ? normalized : DEFAULT_GOAL_LIST_COLUMNS;
  } catch {
    return DEFAULT_GOAL_LIST_COLUMNS;
  }
}

export function saveGoalListColumns(columns: GoalListColumn[]) {
  try {
    const normalized = normalizeGoalListColumns(columns);
    localStorage.setItem(
      GOAL_LIST_COLUMNS_STORAGE_KEY,
      JSON.stringify(normalized.length > 0 ? normalized : DEFAULT_GOAL_LIST_COLUMNS),
    );
  } catch {
    // Ignore localStorage failures.
  }
}
