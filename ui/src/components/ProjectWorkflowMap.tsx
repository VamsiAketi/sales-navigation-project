import { useMemo } from "react";
import type { ProjectIssueStatus } from "@paperclipai/shared";
import { isProjectIssueWorkflowTransitionAllowed } from "@paperclipai/shared";
import { cn } from "@/lib/utils";

const NODE_W = 172;
const NODE_H = 92;
const GAP_X = 36;
const PAD_X = 28;
/** Space above / below node row for curved connectors */
const LANE_ABOVE = 56;
const LANE_BELOW = 56;
const ROW_TOP = LANE_ABOVE + 8;

const ACTOR_SUMMARY: Record<ProjectIssueStatus["allowedActors"], string> = {
  human_and_agent: "Human or AI",
  human_only: "Human only",
  agent_only: "AI only",
};

type DirectedEdge = {
  from: string;
  to: string;
  fromLabel: string;
  toLabel: string;
  iFrom: number;
  iTo: number;
  lane: number;
};

function buildDirectedEdges(sorted: ProjectIssueStatus[]): DirectedEdge[] {
  const indexByValue = new Map(sorted.map((s, i) => [s.value, i]));
  const raw: Omit<DirectedEdge, "lane">[] = [];

  for (const from of sorted) {
    for (const to of sorted) {
      if (from.value === to.value) continue;
      if (!isProjectIssueWorkflowTransitionAllowed(from.value, to.value, from)) continue;
      const iFrom = indexByValue.get(from.value);
      const iTo = indexByValue.get(to.value);
      if (iFrom === undefined || iTo === undefined) continue;
      raw.push({
        from: from.value,
        to: to.value,
        fromLabel: from.name,
        toLabel: to.name,
        iFrom,
        iTo,
      });
    }
  }

  const laneCursor = new Map<number, number>();
  return raw.map((e) => {
    const next = laneCursor.get(e.iFrom) ?? 0;
    laneCursor.set(e.iFrom, next + 1);
    return { ...e, lane: next };
  });
}

/** Right-to-left along the row: arc above; left-to-right when indices decrease: arc below. */
function directedEdgePath(
  centers: { x: number; y: number }[],
  e: DirectedEdge,
): string {
  const { x: fx, y: fy } = centers[e.iFrom]!;
  const { x: tx, y: ty } = centers[e.iTo]!;
  const sx = fx + NODE_W / 2 - 8;
  const sy = fy;
  const ex = tx - NODE_W / 2 + 8;
  const ey = ty;

  const forwardAlongRow = e.iTo > e.iFrom;
  const laneSpread = 18;
  const baseLift = forwardAlongRow ? -LANE_ABOVE + 8 : LANE_BELOW - 8;
  const bump = forwardAlongRow
    ? baseLift - e.lane * laneSpread
    : baseLift + e.lane * laneSpread;

  const midx = (sx + ex) / 2;
  return `M ${sx.toFixed(1)} ${sy.toFixed(1)} C ${midx.toFixed(1)} ${(sy + bump).toFixed(1)} ${midx.toFixed(1)} ${(ey + bump).toFixed(1)} ${ex.toFixed(1)} ${ey.toFixed(1)}`;
}

function transitionsBySource(sorted: ProjectIssueStatus[], edges: DirectedEdge[]) {
  const m = new Map<string, { label: string; targets: { value: string; label: string }[] }>();
  for (const s of edges) {
    if (!m.has(s.from)) {
      m.set(s.from, { label: s.fromLabel, targets: [] });
    }
    m.get(s.from)!.targets.push({ value: s.to, label: s.toLabel });
  }
  for (const v of m.values()) {
    v.targets.sort((a, b) => a.label.localeCompare(b.label));
  }
  return sorted
    .map((st) => {
      const row = m.get(st.value);
      if (!row || row.targets.length === 0) return null;
      return { fromValue: st.value, ...row };
    })
    .filter((x): x is { fromValue: string; label: string; targets: { value: string; label: string }[] } => x !== null);
}

export function ProjectWorkflowMap({
  statuses,
  className,
}: {
  statuses: ProjectIssueStatus[];
  className?: string;
}) {
  const sorted = useMemo(
    () => [...statuses].sort((a, b) => a.position - b.position),
    [statuses],
  );

  const edges = useMemo(() => buildDirectedEdges(sorted), [sorted]);

  const { width, height, nodeCenters } = useMemo(() => {
    const n = sorted.length;
    const w = PAD_X * 2 + Math.max(1, n) * NODE_W + Math.max(0, n - 1) * GAP_X;
    const h = ROW_TOP + NODE_H + LANE_BELOW + 24;
    const centers: { x: number; y: number }[] = [];
    const cy = ROW_TOP + NODE_H / 2;
    for (let i = 0; i < n; i++) {
      const x = PAD_X + i * (NODE_W + GAP_X) + NODE_W / 2;
      centers.push({ x, y: cy });
    }
    return { width: w, height: h, nodeCenters: centers };
  }, [sorted]);

  const edgePaths = useMemo(
    () =>
      edges.map((e) => ({
        edge: e,
        d: directedEdgePath(nodeCenters, e),
        key: `${e.from}->${e.to}`,
        title: `${e.fromLabel} → ${e.toLabel}`,
      })),
    [edges, nodeCenters],
  );

  const summaryRows = useMemo(() => transitionsBySource(sorted, edges), [sorted, edges]);

  if (sorted.length === 0) return null;

  return (
    <div
      className={cn(
        "rounded-xl border border-border/60 bg-muted/15 p-4 shadow-sm dark:bg-muted/10",
        className,
      )}
    >
      <div className="mb-3 space-y-1">
        <h3 className="text-sm font-semibold tracking-tight text-foreground">Workflow map</h3>
        <p className="text-xs leading-relaxed text-muted-foreground">
          <span className="font-medium text-foreground/90">How to read this:</span> each arrow is one allowed move. The
          arrowhead sits on the stage you can <span className="font-medium">move into</span> next (the tip points at the
          destination). Multiple arrows from the same stage mean several next steps are allowed.
        </p>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border/40 bg-background [-webkit-overflow-scrolling:touch]">
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          className="min-h-[240px] min-w-[min(100%,520px)]"
          role="img"
          aria-label="Workflow transitions between stages"
        >
          <defs>
            <marker
              id="workflow-arrowhead"
              markerUnits="userSpaceOnUse"
              markerWidth="11"
              markerHeight="11"
              refX="9.5"
              refY="5.5"
              orient="auto"
            >
              <path
                d="M0.5 0.5 L9.5 5.5 L0.5 10.5 Z"
                className="fill-foreground/55 stroke-foreground/35"
                strokeWidth={0.5}
              />
            </marker>
          </defs>

          <g>
            {edgePaths.map(({ key, d, title }) => (
              <path
                key={key}
                d={d}
                fill="none"
                className="stroke-foreground/45 transition-[stroke-opacity] hover:stroke-foreground/80 dark:stroke-foreground/50 dark:hover:stroke-foreground/85"
                strokeWidth={2.75}
                strokeLinecap="round"
                strokeLinejoin="round"
                markerEnd="url(#workflow-arrowhead)"
              >
                <title>{title}</title>
              </path>
            ))}
          </g>

          {sorted.map((s, i) => {
            const x = PAD_X + i * (NODE_W + GAP_X);
            const y = ROW_TOP;
            const restricted = (s.allowedNextStatusValues?.length ?? 0) > 0;
            const actorLine = s.isHumanApproval ? "Human approval" : ACTOR_SUMMARY[s.allowedActors];

            return (
              <g key={s.id} transform={`translate(${x},${y})`}>
                <rect
                  width={NODE_W}
                  height={NODE_H}
                  rx={10}
                  className="fill-card"
                  stroke={s.color}
                  strokeWidth={2}
                />
                <text x={14} y={26} className="fill-foreground text-[13px] font-semibold">
                  {s.name.length > 22 ? `${s.name.slice(0, 20)}…` : s.name}
                </text>
                {restricted ? (
                  <text
                    x={NODE_W - 14}
                    y={22}
                    textAnchor="end"
                    className="fill-amber-700 text-[9px] font-semibold dark:fill-amber-400"
                  >
                    R
                  </text>
                ) : null}
                <text x={14} y={48} className="fill-muted-foreground text-[11px]">
                  {actorLine}
                </text>
                {s.isHumanApproval ? (
                  <text x={14} y={66} className="fill-muted-foreground/90 text-[10px]">
                    Approvers required
                  </text>
                ) : (
                  <text x={14} y={66} className="fill-muted-foreground/90 text-[10px]">
                    {!s.isActive ? "Board: hidden" : "Board: visible"}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      <div className="mt-4 rounded-lg border border-border/50 bg-muted/20 px-3 py-2.5 dark:bg-muted/15">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Allowed moves (same as arrows)
        </p>
        <ul className="space-y-1.5 text-sm">
          {summaryRows.map(({ fromValue, label, targets }) => (
            <li key={fromValue} className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="shrink-0 font-medium text-foreground">{label}</span>
              <span className="font-medium text-foreground/70" aria-hidden>
                →
              </span>
              <span className="min-w-0 text-muted-foreground">{targets.map((t) => t.label).join(" · ")}</span>
            </li>
          ))}
        </ul>
        {edges.length === 0 ? (
          <p className="text-sm text-muted-foreground">No transitions between stages (add stages or relax transition rules).</p>
        ) : null}
      </div>

      <p className="mt-2 text-[11px] text-muted-foreground">
        <span className="font-medium text-amber-800 dark:text-amber-300">R</span> on a card — only selected “next”
        stages are allowed out of that stage. Hover an arrow in the diagram for the exact pair. Reciprocal moves (A→B and
        B→A) appear as two separate arrows.
      </p>
    </div>
  );
}
