import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { Link, useNavigate } from "@/lib/router";
import type { Goal, Project } from "@paperclipai/shared";
import { GOAL_LEVELS, GOAL_STATUSES } from "@paperclipai/shared";
import { projectLinkedToGoal } from "../lib/goal-rollup";
import {
  DEFAULT_GOAL_LIST_COLUMNS,
  goalListColumnLabels,
  goalListColumns,
  loadGoalListColumns,
  normalizeGoalListColumns,
  saveGoalListColumns,
  type GoalListColumn,
} from "../lib/goals-list-columns";
import { cn, formatDate, projectUrl } from "../lib/utils";
import { StatusBadge } from "./StatusBadge";
import { EmptyState } from "./EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ArrowUpDown, ChevronDown, Columns3, Plus, Search, Target } from "lucide-react";

type GoalListSortField = "name" | "status" | "level" | "created";

const GOAL_STATUS_ORDER = [...GOAL_STATUSES];
const GOAL_LEVEL_ORDER = [...GOAL_LEVELS];

const DEFAULT_GOAL_COLUMN_WIDTH_WEIGHTS: Record<GoalListColumn, number> = {
  name: 260,
  status: 120,
  level: 100,
  parent: 180,
  projects: 220,
  created: 120,
};

const GOAL_COLUMN_MIN_WIDTHS: Record<GoalListColumn, number> = {
  name: 160,
  status: 100,
  level: 90,
  parent: 100,
  projects: 140,
  created: 100,
};

const GOAL_LIST_COLUMN_GAP_PX = 12;

/** Below lg (1024px): stacked toolbar and viewport-sized filter popovers. */
const GOALS_COMPACT_TOOLBAR_MQ = "(max-width: 1023px)";

const GOALS_POPOVER_PANEL_CLASS =
  "z-230 max-h-[min(32rem,calc(100dvh-6rem))] overflow-y-auto overscroll-contain shadow-lg";

const GOALS_POPOVER_WIDE_CLASS = cn(
  GOALS_POPOVER_PANEL_CLASS,
  "w-[calc(100vw-1.5rem)] sm:w-[min(40rem,calc(100vw-2rem))]",
);

const GOALS_POPOVER_NARROW_CLASS = cn(
  GOALS_POPOVER_PANEL_CLASS,
  "w-[calc(100vw-1.5rem)] sm:w-72",
);

function useGoalsCompactToolbar() {
  const [compact, setCompact] = useState(
    () => typeof window !== "undefined" && window.matchMedia(GOALS_COMPACT_TOOLBAR_MQ).matches,
  );
  useEffect(() => {
    const mql = window.matchMedia(GOALS_COMPACT_TOOLBAR_MQ);
    const onChange = () => setCompact(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);
  return compact;
}

function GoalsFilterPopover({ children, ...props }: ComponentProps<typeof Popover>) {
  const compact = useGoalsCompactToolbar();
  return (
    <Popover modal={compact} {...props}>
      {children}
    </Popover>
  );
}

function GoalsFilterPopoverContent({
  className,
  narrow = false,
  ...props
}: ComponentProps<typeof PopoverContent> & { narrow?: boolean }) {
  const compact = useGoalsCompactToolbar();
  return (
    <PopoverContent
      align={compact ? "start" : "end"}
      side={compact ? "bottom" : undefined}
      collisionPadding={compact ? 16 : 8}
      sideOffset={compact ? 8 : undefined}
      className={cn(
        compact
          ? narrow
            ? GOALS_POPOVER_NARROW_CLASS
            : GOALS_POPOVER_WIDE_CLASS
          : narrow
            ? "z-220 max-h-[min(32rem,calc(100dvh-3rem))] w-56 overflow-y-auto"
            : "z-220 max-h-[min(33.5rem,calc(100dvh-3rem))] w-[min(40rem,calc(100vw-1rem))] overflow-y-auto",
        className,
      )}
      {...props}
    />
  );
}

function GoalsFilterOptionRow({
  checked,
  onToggle,
  children,
}: {
  checked: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <label className="flex w-full cursor-pointer items-center gap-2.5 rounded-sm px-2 py-2 text-sm hover:bg-accent/50 max-lg:min-h-11 lg:py-1.5">
      <Checkbox
        checked={checked}
        onCheckedChange={() => onToggle()}
        className="size-4 shrink-0 self-center"
      />
      {children}
    </label>
  );
}

function goalListGapPx(columnCount: number): number {
  return Math.max(0, columnCount - 1) * GOAL_LIST_COLUMN_GAP_PX;
}

function defaultGoalColumnWidthsFromAvailableWidth(
  availableWidth: number,
  visibleColumns: readonly GoalListColumn[],
): Record<GoalListColumn, number> {
  const result = { ...DEFAULT_GOAL_COLUMN_WIDTH_WEIGHTS };
  if (visibleColumns.length === 0) return result;

  const weightTotal = visibleColumns.reduce(
    (sum, column) => sum + DEFAULT_GOAL_COLUMN_WIDTH_WEIGHTS[column],
    0,
  );
  const minTotal = visibleColumns.reduce((sum, column) => sum + GOAL_COLUMN_MIN_WIDTHS[column], 0);
  const usableWidth = Math.max(minTotal, availableWidth - goalListGapPx(visibleColumns.length));

  for (const column of visibleColumns) {
    const ratio = DEFAULT_GOAL_COLUMN_WIDTH_WEIGHTS[column] / weightTotal;
    result[column] = Math.max(GOAL_COLUMN_MIN_WIDTHS[column], Math.round(usableWidth * ratio));
  }
  return result;
}

function getInitialDefaultGoalColumnWidths(
  visibleColumns: readonly GoalListColumn[] = goalListColumns,
): Record<GoalListColumn, number> {
  if (typeof window === "undefined") return { ...DEFAULT_GOAL_COLUMN_WIDTH_WEIGHTS };
  return defaultGoalColumnWidthsFromAvailableWidth(window.innerWidth * 0.72, visibleColumns);
}

function formatEnumLabel(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function sortGoals(list: Goal[], sortField: GoalListSortField, sortDir: "asc" | "desc"): Goal[] {
  const dir = sortDir === "asc" ? 1 : -1;
  const sorted = [...list];
  sorted.sort((a, b) => {
    if (sortField === "name") return dir * a.title.localeCompare(b.title);
    if (sortField === "status") {
      return dir * (GOAL_STATUS_ORDER.indexOf(a.status) - GOAL_STATUS_ORDER.indexOf(b.status));
    }
    if (sortField === "level") {
      return dir * (GOAL_LEVEL_ORDER.indexOf(a.level) - GOAL_LEVEL_ORDER.indexOf(b.level));
    }
    return dir * (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  });
  return sorted;
}

function projectsForGoal(projects: Project[], goalId: string): { id: string; name: string }[] {
  return projects
    .filter((project) => projectLinkedToGoal(project, goalId))
    .map((project) => ({ id: project.id, name: project.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function GoalEnumPicker({
  current,
  options,
  onChange,
  children,
}: {
  current: string;
  options: readonly string[];
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="cursor-pointer text-left transition-opacity hover:opacity-80"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {children}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-40 p-1" align="start" onClick={(e) => e.stopPropagation()}>
        {options.map((opt) => (
          <Button
            key={opt}
            type="button"
            variant="ghost"
            size="sm"
            className={cn("w-full justify-start text-xs", opt === current && "bg-accent")}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onChange(opt);
              setOpen(false);
            }}
          >
            {formatEnumLabel(opt)}
          </Button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

interface GoalsListProps {
  goals: Goal[];
  projects: Project[];
  isLoading?: boolean;
  error?: Error | null;
  canWriteGoals?: boolean;
  onUpdateGoal?: (id: string, data: Record<string, unknown>) => void;
  onNewGoal?: () => void;
}

export function GoalsList({
  goals,
  projects,
  isLoading,
  error,
  canWriteGoals = false,
  onUpdateGoal,
  onNewGoal,
}: GoalsListProps) {
  const navigate = useNavigate();
  const goalsCompactToolbar = useGoalsCompactToolbar();
  const [goalSearch, setGoalSearch] = useState("");
  const [statusFilters, setStatusFilters] = useState<string[]>([]);
  const [levelFilters, setLevelFilters] = useState<string[]>([]);
  const [projectFilters, setProjectFilters] = useState<string[]>([]);
  const [sortField, setSortField] = useState<GoalListSortField>("created");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [visibleColumns, setVisibleColumns] = useState<GoalListColumn[]>(loadGoalListColumns);
  const [columnWidths, setColumnWidths] = useState<Record<GoalListColumn, number>>(
    () => getInitialDefaultGoalColumnWidths(),
  );
  const listMeasureRef = useRef<HTMLDivElement | null>(null);
  const hasUserResizedColumnsRef = useRef(false);
  const resizeSessionRef = useRef<{
    column: GoalListColumn;
    startX: number;
    startWidth: number;
  } | null>(null);

  const visibleColumnSet = useMemo(() => new Set(visibleColumns), [visibleColumns]);
  const orderedVisibleColumns = useMemo(
    () => goalListColumns.filter((column) => visibleColumnSet.has(column)),
    [visibleColumnSet],
  );

  const goalsById = useMemo(() => new Map(goals.map((goal) => [goal.id, goal])), [goals]);

  const projectsByGoalId = useMemo(() => {
    const map = new Map<string, { id: string; name: string }[]>();
    for (const goal of goals) {
      map.set(goal.id, projectsForGoal(projects, goal.id));
    }
    return map;
  }, [goals, projects]);

  const parentGoalLabel = useCallback(
    (goal: Goal): string => {
      if (!goal.parentId) return "none";
      return goalsById.get(goal.parentId)?.title ?? goal.parentId.slice(0, 8);
    },
    [goalsById],
  );

  const projectFilterOptions = useMemo(() => {
    const byId = new Map<string, string>();
    for (const project of projects) {
      if (!project.archivedAt) byId.set(project.id, project.name);
    }
    return Array.from(byId.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [projects]);

  const applyGoalFilters = useCallback(
    (list: Goal[]) => {
      const query = goalSearch.trim().toLowerCase();
      return list.filter((goal) => {
        if (statusFilters.length > 0 && !statusFilters.includes(goal.status)) return false;
        if (levelFilters.length > 0 && !levelFilters.includes(goal.level)) return false;
        const linkedProjects = projectsByGoalId.get(goal.id) ?? [];
        if (projectFilters.length > 0 && !linkedProjects.some((p) => projectFilters.includes(p.id))) {
          return false;
        }
        if (!query) return true;
        const parentLabel = parentGoalLabel(goal);
        return (
          goal.title.toLowerCase().includes(query) ||
          (goal.description ?? "").toLowerCase().includes(query) ||
          parentLabel.toLowerCase().includes(query) ||
          linkedProjects.some((p) => p.name.toLowerCase().includes(query))
        );
      });
    },
    [goalSearch, levelFilters, parentGoalLabel, projectFilters, projectsByGoalId, statusFilters],
  );

  const visibleGoals = useMemo(
    () => sortGoals(applyGoalFilters(goals), sortField, sortDir),
    [applyGoalFilters, goals, sortDir, sortField],
  );

  const stopColumnResize = useCallback(() => {
    resizeSessionRef.current = null;
    window.removeEventListener("mousemove", onColumnResizeMove);
    window.removeEventListener("mouseup", stopColumnResize);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }, []);

  const onColumnResizeMove = useCallback((event: MouseEvent) => {
    const session = resizeSessionRef.current;
    if (!session) return;
    const delta = event.clientX - session.startX;
    const next = Math.max(GOAL_COLUMN_MIN_WIDTHS[session.column], Math.round(session.startWidth + delta));
    setColumnWidths((prev) => {
      if (prev[session.column] === next) return prev;
      return { ...prev, [session.column]: next };
    });
  }, []);

  useEffect(() => {
    resizeSessionRef.current = null;
    window.removeEventListener("mousemove", onColumnResizeMove);
    window.removeEventListener("mouseup", stopColumnResize);
  }, [onColumnResizeMove, stopColumnResize]);

  const startColumnResize = useCallback(
    (column: GoalListColumn, event: ReactMouseEvent<HTMLSpanElement>) => {
      event.preventDefault();
      event.stopPropagation();
      hasUserResizedColumnsRef.current = true;
      resizeSessionRef.current = {
        column,
        startX: event.clientX,
        startWidth: columnWidths[column],
      };
      window.addEventListener("mousemove", onColumnResizeMove);
      window.addEventListener("mouseup", stopColumnResize);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [columnWidths, onColumnResizeMove, stopColumnResize],
  );

  const applyAutoColumnWidths = useCallback(() => {
    if (hasUserResizedColumnsRef.current) return;
    const availableWidth = listMeasureRef.current?.clientWidth ?? 0;
    if (availableWidth <= 0) return;
    setColumnWidths(defaultGoalColumnWidthsFromAvailableWidth(availableWidth, orderedVisibleColumns));
  }, [orderedVisibleColumns]);

  useLayoutEffect(() => {
    applyAutoColumnWidths();
  }, [applyAutoColumnWidths, visibleGoals.length]);

  useEffect(() => {
    const element = listMeasureRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      applyAutoColumnWidths();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [applyAutoColumnWidths]);

  const goalGridStyle = useMemo(
    () => ({
      gridTemplateColumns: orderedVisibleColumns.map((column) => `${columnWidths[column]}px`).join(" "),
    }),
    [columnWidths, orderedVisibleColumns],
  );

  const renderColumnResizer = useCallback(
    (column: GoalListColumn, label: string) => (
      <span
        role="separator"
        aria-orientation="vertical"
        aria-label={label}
        className="absolute right-0 top-0 h-full w-2 cursor-col-resize select-none touch-none"
        onMouseDown={(event) => startColumnResize(column, event)}
      >
        <span className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border/80" />
      </span>
    ),
    [startColumnResize],
  );

  const setColumns = useCallback((next: GoalListColumn[]) => {
    const normalized = normalizeGoalListColumns(next);
    setVisibleColumns(normalized.length > 0 ? normalized : DEFAULT_GOAL_LIST_COLUMNS);
    saveGoalListColumns(normalized.length > 0 ? normalized : DEFAULT_GOAL_LIST_COLUMNS);
  }, []);

  const toggleColumn = useCallback(
    (column: GoalListColumn, checked: boolean) => {
      if (checked) {
        if (!visibleColumns.includes(column)) setColumns([...visibleColumns, column]);
        return;
      }
      if (visibleColumns.length <= 1) return;
      setColumns(visibleColumns.filter((value) => value !== column));
    },
    [setColumns, visibleColumns],
  );

  const activeFilterCount =
    statusFilters.length +
    levelFilters.length +
    projectFilters.length +
    (goalSearch.trim() ? 1 : 0);

  const applySort = (field: GoalListSortField) => {
    if (sortField === field) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setSortField(field);
    setSortDir("asc");
  };

  const resetFiltersAndSort = () => {
    setGoalSearch("");
    setStatusFilters([]);
    setLevelFilters([]);
    setProjectFilters([]);
    setSortField("created");
    setSortDir("asc");
  };

  const renderProjects = (goalId: string) => {
    const linkedProjects = projectsByGoalId.get(goalId) ?? [];
    if (linkedProjects.length === 0) {
      return <span className="text-xs text-muted-foreground">No projects</span>;
    }
    const availableWidth = Math.max(GOAL_COLUMN_MIN_WIDTHS.projects, columnWidths.projects) - 8;
    const gapPx = 4;
    const estimateChipWidth = (name: string) => Math.min(176, Math.max(56, 26 + name.length * 6));
    const estimateCounterWidth = (count: number) => Math.max(20, 12 + String(count).length * 6);

    let showSecond = false;
    if (linkedProjects.length > 1) {
      const secondWidth = estimateChipWidth(linkedProjects[1]!.name);
      const counterAfterSecond =
        linkedProjects.length > 2 ? estimateCounterWidth(linkedProjects.length - 2) + gapPx : 0;
      const remainingForFirst = availableWidth - gapPx - secondWidth - counterAfterSecond;
      showSecond = remainingForFirst >= 72;
    }

    const visible = showSecond ? linkedProjects.slice(0, 2) : linkedProjects.slice(0, 1);
    const hiddenCount = Math.max(0, linkedProjects.length - visible.length);
    const counterWidth = hiddenCount > 0 ? estimateCounterWidth(hiddenCount) : 0;
    const secondWidthEstimate = visible.length > 1 ? estimateChipWidth(visible[1]!.name) : 0;
    const firstChipMaxWidth = Math.max(
      56,
      availableWidth
        - (visible.length > 1 ? gapPx + secondWidthEstimate : 0)
        - (hiddenCount > 0 ? gapPx + counterWidth : 0),
    );
    const secondChipMaxWidth = Math.max(
      56,
      availableWidth
        - firstChipMaxWidth
        - (hiddenCount > 0 ? gapPx + counterWidth : 0)
        - (visible.length > 1 ? gapPx : 0),
    );

    return (
      <span className="flex min-w-0 items-center gap-1 overflow-hidden">
        {visible.map((project, index) => (
          <Link
            key={project.id}
            to={projectUrl(project)}
            className="inline-flex shrink-0 min-w-0 items-center truncate rounded-full border border-border px-2 py-0.5 text-xs no-underline text-inherit transition-colors hover:bg-accent/50"
            title={project.name}
            style={{ maxWidth: `${index === 0 ? firstChipMaxWidth : secondChipMaxWidth}px` }}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <span className="truncate">{project.name}</span>
          </Link>
        ))}
        {hiddenCount > 0 ? (
          <span className="shrink-0 text-xs text-muted-foreground">+{hiddenCount}</span>
        ) : null}
      </span>
    );
  };

  const openGoal = useCallback(
    (goalId: string) => {
      navigate(`/goals/${goalId}`);
    },
    [navigate],
  );

  const handleGoalRowClick = useCallback(
    (goalId: string, event: ReactMouseEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement;
      if (target.closest("a, button, [role='menuitem'], label, input, textarea, select")) return;
      openGoal(goalId);
    },
    [openGoal],
  );

  const handleGoalRowKeyDown = useCallback(
    (goalId: string, event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const target = event.target as HTMLElement;
      if (target !== event.currentTarget && target.closest("a, button, [role='menuitem'], label, input")) return;
      event.preventDefault();
      openGoal(goalId);
    },
    [openGoal],
  );

  const mobileProjectsSummary = (goalId: string): string => {
    const linkedProjects = projectsByGoalId.get(goalId) ?? [];
    if (linkedProjects.length === 0) return "No projects";
    if (linkedProjects.length === 1) return linkedProjects[0]!.name;
    return `${linkedProjects.length} projects`;
  };

  const renderHeaderCell = (column: GoalListColumn) => {
    switch (column) {
      case "name":
        return (
          <span key={column} className="relative truncate">
            <button type="button" className="w-full truncate text-left hover:text-foreground" onClick={() => applySort("name")}>
              Name {sortField === "name" ? (sortDir === "asc" ? "↑" : "↓") : ""}
            </button>
            {renderColumnResizer(column, "Resize Name column")}
          </span>
        );
      case "status":
        return (
          <span key={column} className="relative truncate">
            <button type="button" className="w-full truncate text-left hover:text-foreground" onClick={() => applySort("status")}>
              Status {sortField === "status" ? (sortDir === "asc" ? "↑" : "↓") : ""}
            </button>
            {renderColumnResizer(column, "Resize Status column")}
          </span>
        );
      case "level":
        return (
          <span key={column} className="relative truncate">
            <button type="button" className="w-full truncate text-left hover:text-foreground" onClick={() => applySort("level")}>
              Level {sortField === "level" ? (sortDir === "asc" ? "↑" : "↓") : ""}
            </button>
            {renderColumnResizer(column, "Resize Level column")}
          </span>
        );
      case "parent":
        return (
          <span key={column} className="relative truncate">
            Parent goal
            {renderColumnResizer(column, "Resize Parent goal column")}
          </span>
        );
      case "projects":
        return (
          <span key={column} className="relative truncate">
            Projects
            {renderColumnResizer(column, "Resize Projects column")}
          </span>
        );
      case "created":
        return (
          <span key={column} className="relative truncate">
            <button type="button" className="w-full truncate text-left hover:text-foreground" onClick={() => applySort("created")}>
              Created date {sortField === "created" ? (sortDir === "asc" ? "↑" : "↓") : ""}
            </button>
            {renderColumnResizer(column, "Resize Created date column")}
          </span>
        );
    }
  };

  const renderRowCell = (goal: Goal, column: GoalListColumn) => {
    switch (column) {
      case "name":
        return (
          <span key={column} className="hidden min-w-0 truncate pr-2 md:block" title={goal.title}>
            {goal.title}
          </span>
        );
      case "status":
        return (
          <span key={column} className="hidden min-w-0 md:block">
            {canWriteGoals && onUpdateGoal ? (
              <GoalEnumPicker
                current={goal.status}
                options={GOAL_STATUSES}
                onChange={(status) => onUpdateGoal(goal.id, { status })}
              >
                <StatusBadge status={goal.status} />
              </GoalEnumPicker>
            ) : (
              <StatusBadge status={goal.status} />
            )}
          </span>
        );
      case "level":
        return (
          <span key={column} className="hidden min-w-0 md:block">
            {canWriteGoals && onUpdateGoal ? (
              <GoalEnumPicker
                current={goal.level}
                options={GOAL_LEVELS}
                onChange={(level) => onUpdateGoal(goal.id, { level })}
              >
                <span className="text-sm capitalize">{goal.level}</span>
              </GoalEnumPicker>
            ) : (
              <span className="text-sm capitalize">{goal.level}</span>
            )}
          </span>
        );
      case "parent": {
        const label = parentGoalLabel(goal);
        return (
          <span key={column} className="hidden min-w-0 md:block">
            {goal.parentId ? (
              <Link
                to={`/goals/${goal.parentId}`}
                className="block truncate text-sm text-inherit no-underline transition-colors hover:underline"
                title={label}
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
              >
                {label}
              </Link>
            ) : (
              <span className="text-sm text-muted-foreground">none</span>
            )}
          </span>
        );
      }
      case "projects":
        return (
          <span key={column} className="hidden min-w-0 md:block">
            {renderProjects(goal.id)}
          </span>
        );
      case "created":
        return (
          <span key={column} className="hidden text-xs text-muted-foreground md:block">
            {formatDate(goal.createdAt)}
          </span>
        );
    }
  };

  if (isLoading) return null;

  return (
    <div className="space-y-0">
      <div className="-mx-4 border-b border-border/80 bg-background/95 px-4 py-2 backdrop-blur supports-backdrop-filter:bg-background/80 md:sticky md:top-0 md:z-60 md:-mx-6 md:px-6">
        <div className="flex max-lg:flex-col max-lg:gap-2 lg:flex-row lg:items-center lg:gap-2.5">
          <div className="flex min-w-0 items-center gap-2 max-lg:w-full lg:min-w-0 lg:shrink-0 lg:gap-2.5">
            <div className="relative min-w-0 flex-1 max-lg:min-w-0 lg:w-64">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={goalSearch}
                onChange={(e) => setGoalSearch(e.target.value)}
                placeholder="Search goals..."
                className="h-9 w-full pl-7 text-sm"
                aria-label="Search goals"
              />
            </div>
            {canWriteGoals && onNewGoal ? (
              <Button size="sm" className="h-9 w-9 shrink-0 p-0 lg:hidden" onClick={onNewGoal}>
                <Plus className="h-4 w-4" aria-hidden />
                <span className="sr-only">New Goal</span>
              </Button>
            ) : null}
          </div>

          <div
            className={cn(
              "flex min-w-0 gap-1.5 lg:shrink-0 lg:items-center",
              goalsCompactToolbar
                ? "max-lg:w-full max-lg:flex-col max-lg:rounded-md max-lg:border max-lg:border-border max-lg:bg-muted/20 max-lg:p-2"
                : "max-lg:w-full max-lg:flex-wrap max-lg:items-center",
            )}
          >
            {(activeFilterCount > 0 || sortField !== "created" || sortDir !== "asc") ? (
              <Button
                variant="outline"
                size="sm"
                className={cn(
                  "h-9 shrink-0 px-3 text-xs text-muted-foreground hover:text-foreground",
                  goalsCompactToolbar && "max-lg:self-start",
                )}
                onClick={resetFiltersAndSort}
              >
                Clear filters
              </Button>
            ) : null}
            <div className="flex min-w-0 flex-wrap items-center gap-1.5 max-lg:w-full">
              <GoalsFilterPopover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className={cn(
                      "h-9 max-lg:shrink-0 gap-1.5 px-3 text-xs",
                      statusFilters.length > 0 && "border-blue-400/50 text-blue-700 dark:text-blue-300",
                    )}
                  >
                    <span>Status</span>
                    {statusFilters.length > 0 ? (
                      <span className="text-[10px] font-medium">{statusFilters.length}</span>
                    ) : null}
                    <ChevronDown className="hidden h-3.5 w-3.5 lg:block" />
                  </Button>
                </PopoverTrigger>
                <GoalsFilterPopoverContent narrow className="p-2">
                  <div className="max-h-60 space-y-0.5 overflow-y-auto rounded-md border border-border/80 bg-muted/15 p-1.5">
                    {GOAL_STATUS_ORDER.map((status) => (
                      <GoalsFilterOptionRow
                        key={status}
                        checked={statusFilters.includes(status)}
                        onToggle={() => {
                          setStatusFilters((prev) =>
                            prev.includes(status) ? prev.filter((s) => s !== status) : [...prev, status],
                          );
                        }}
                      >
                        <StatusBadge status={status} />
                      </GoalsFilterOptionRow>
                    ))}
                  </div>
                </GoalsFilterPopoverContent>
              </GoalsFilterPopover>
              <GoalsFilterPopover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className={cn(
                      "h-9 max-lg:shrink-0 gap-1.5 px-3 text-xs",
                      levelFilters.length > 0 && "border-blue-400/50 text-blue-700 dark:text-blue-300",
                    )}
                  >
                    <span>Level</span>
                    {levelFilters.length > 0 ? (
                      <span className="text-[10px] font-medium">{levelFilters.length}</span>
                    ) : null}
                    <ChevronDown className="hidden h-3.5 w-3.5 lg:block" />
                  </Button>
                </PopoverTrigger>
                <GoalsFilterPopoverContent narrow className="p-2">
                  <div className="max-h-60 space-y-0.5 overflow-y-auto rounded-md border border-border/80 bg-muted/15 p-1.5">
                    {GOAL_LEVEL_ORDER.map((level) => (
                      <GoalsFilterOptionRow
                        key={level}
                        checked={levelFilters.includes(level)}
                        onToggle={() => {
                          setLevelFilters((prev) =>
                            prev.includes(level) ? prev.filter((l) => l !== level) : [...prev, level],
                          );
                        }}
                      >
                        <span className="capitalize">{level}</span>
                      </GoalsFilterOptionRow>
                    ))}
                  </div>
                </GoalsFilterPopoverContent>
              </GoalsFilterPopover>
              {projectFilterOptions.length > 0 ? (
                <GoalsFilterPopover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className={cn(
                        "h-9 max-lg:shrink-0 gap-1.5 px-3 text-xs",
                        projectFilters.length > 0 && "border-blue-400/50 text-blue-700 dark:text-blue-300",
                      )}
                    >
                      <span>Project</span>
                      {projectFilters.length > 0 ? (
                        <span className="text-[10px] font-medium">{projectFilters.length}</span>
                      ) : null}
                      <ChevronDown className="hidden h-3.5 w-3.5 lg:block" />
                    </Button>
                  </PopoverTrigger>
                  <GoalsFilterPopoverContent narrow className="p-2">
                    <div className="max-h-60 space-y-0.5 overflow-y-auto rounded-md border border-border/80 bg-muted/15 p-1.5">
                      {projectFilterOptions.map((project) => (
                        <GoalsFilterOptionRow
                          key={project.id}
                          checked={projectFilters.includes(project.id)}
                          onToggle={() => {
                            setProjectFilters((prev) =>
                              prev.includes(project.id)
                                ? prev.filter((id) => id !== project.id)
                                : [...prev, project.id],
                            );
                          }}
                        >
                          <span className="truncate">{project.name}</span>
                        </GoalsFilterOptionRow>
                      ))}
                    </div>
                  </GoalsFilterPopoverContent>
                </GoalsFilterPopover>
              ) : null}
              <GoalsFilterPopover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="h-9 max-lg:shrink-0 gap-1.5 px-3 text-xs">
                    <ArrowUpDown className="h-3.5 w-3.5" />
                    <span>Sort</span>
                  </Button>
                </PopoverTrigger>
                <GoalsFilterPopoverContent narrow className="p-0">
                  <div className="space-y-0.5 p-2">
                    {([
                      ["name", "Name"],
                      ["status", "Status"],
                      ["level", "Level"],
                      ["created", "Created date"],
                    ] as const).map(([field, label]) => (
                      <button
                        key={field}
                        type="button"
                        className={cn(
                          "flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-sm max-lg:min-h-11",
                          sortField === field
                            ? "bg-accent/50 text-foreground"
                            : "text-muted-foreground hover:bg-accent/50",
                        )}
                        onClick={() => applySort(field)}
                      >
                        <span>{label}</span>
                        {sortField === field ? (
                          <span className="text-xs text-muted-foreground">{sortDir === "asc" ? "↑" : "↓"}</span>
                        ) : null}
                      </button>
                    ))}
                  </div>
                </GoalsFilterPopoverContent>
              </GoalsFilterPopover>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="hidden h-9 shrink-0 gap-1.5 px-3 text-xs lg:inline-flex">
                    <Columns3 className="h-3.5 w-3.5" />
                    <span>Columns</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel>Show columns</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {goalListColumns.map((column) => (
                    <DropdownMenuCheckboxItem
                      key={column}
                      checked={visibleColumnSet.has(column)}
                      onSelect={(event) => event.preventDefault()}
                      onCheckedChange={(checked) => toggleColumn(column, checked === true)}
                    >
                      {goalListColumnLabels[column]}
                    </DropdownMenuCheckboxItem>
                  ))}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => setColumns(DEFAULT_GOAL_LIST_COLUMNS)}>
                    Reset defaults
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              {canWriteGoals && onNewGoal ? (
                <Button size="sm" className="hidden h-9 shrink-0 px-3 lg:ml-auto lg:inline-flex" onClick={onNewGoal}>
                  <Plus className="h-4 w-4 sm:mr-1" />
                  <span>New Goal</span>
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      {error ? <p className="text-sm text-destructive">{error.message}</p> : null}

      {!isLoading && goals.length > 0 && visibleGoals.length === 0 ? (
        <EmptyState icon={Target} message="No goals match the current filters." />
      ) : null}

      {!isLoading && visibleGoals.length > 0 && orderedVisibleColumns.length > 0 ? (
        <div ref={listMeasureRef} className="w-full min-w-0">
          <div
            className="sticky top-[3.25rem] z-50 hidden w-full min-w-0 border-b border-border bg-background/95 px-2 py-1.5 text-xs font-medium text-muted-foreground backdrop-blur supports-[backdrop-filter]:bg-background/90 md:grid md:items-center md:gap-3"
            style={goalGridStyle}
          >
            {orderedVisibleColumns.map((column) => renderHeaderCell(column))}
          </div>
          <div className="w-full min-w-0 border border-border max-lg:border-x-0 max-lg:border-t-0">
            {visibleGoals.map((goal) => (
              <div
                key={goal.id}
                role="link"
                tabIndex={0}
                className="block w-full min-w-0 cursor-pointer border-b border-border px-3 py-3 text-sm text-inherit transition-colors hover:bg-accent/50 last:border-b-0 md:grid md:items-center md:gap-3 md:px-2 md:py-2"
                style={goalGridStyle}
                onClick={(event) => handleGoalRowClick(goal.id, event)}
                onKeyDown={(event) => handleGoalRowKeyDown(goal.id, event)}
              >
                <span className="flex min-w-0 flex-col gap-1.5 md:hidden">
                  <span className="flex min-w-0 items-start justify-between gap-2">
                    <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
                      <span
                        className="inline-flex shrink-0"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                        }}
                        onPointerDown={(e) => e.stopPropagation()}
                      >
                        {canWriteGoals && onUpdateGoal ? (
                          <GoalEnumPicker
                            current={goal.status}
                            options={GOAL_STATUSES}
                            onChange={(status) => onUpdateGoal(goal.id, { status })}
                          >
                            <StatusBadge status={goal.status} />
                          </GoalEnumPicker>
                        ) : (
                          <StatusBadge status={goal.status} />
                        )}
                      </span>
                      <span
                        className="min-w-0 break-words text-[15px] font-medium leading-snug [overflow-wrap:anywhere]"
                        title={goal.title}
                      >
                        {goal.title}
                      </span>
                    </span>
                    <span className="shrink-0 pt-0.5 text-[11px] tabular-nums text-muted-foreground">
                      {formatDate(goal.createdAt)}
                    </span>
                  </span>
                  <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                    <span
                      className="inline-flex shrink-0 items-center rounded-md border border-border/80 bg-muted/30 px-1.5 py-0.5 text-[11px] font-medium capitalize text-muted-foreground"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                      }}
                      onPointerDown={(e) => e.stopPropagation()}
                    >
                      {canWriteGoals && onUpdateGoal ? (
                        <GoalEnumPicker
                          current={goal.level}
                          options={GOAL_LEVELS}
                          onChange={(level) => onUpdateGoal(goal.id, { level })}
                        >
                          <span>{goal.level}</span>
                        </GoalEnumPicker>
                      ) : (
                        <span>{goal.level}</span>
                      )}
                    </span>
                    <span className="max-w-full truncate text-[11px] text-muted-foreground">
                      {mobileProjectsSummary(goal.id)}
                    </span>
                    {goal.parentId ? (
                      <span className="max-w-full truncate text-[11px] text-muted-foreground">
                        {parentGoalLabel(goal)}
                      </span>
                    ) : null}
                  </span>
                </span>
                {orderedVisibleColumns.map((column) => renderRowCell(goal, column))}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
