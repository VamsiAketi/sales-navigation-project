import { useCallback, useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Inbox,
  Target,
  LayoutDashboard,
  DollarSign,
  History,
  Network,
  Boxes,
  Repeat,
  Settings,
  CreditCard,
  Link2,
  Users,
  GripVertical,
  CheckSquare,
} from "lucide-react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  type DragEndEvent,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { SidebarNavItem } from "./SidebarNavItem";
import { SidebarSection } from "./SidebarSection";
import { PluginSlotOutlet } from "@/plugins/slots";
import { useCompany } from "../context/CompanyContext";
import { useSidebar } from "../context/SidebarContext";
import { authApi } from "../api/auth";
import { sidebarBadgesApi } from "../api/sidebarBadges";
import { queryKeys } from "../lib/queryKeys";
import { SHOW_BETA_UI } from "../lib/show-beta-ui";
import { azureSidebarIcon } from "../lib/sidebar-icon-tints";
import {DEFAULT_PRIMARY_NAV_IDS, ROUTINES_NAV_ID} from "../lib/sidebar-menu-order";
import { usePrimarySidebarNavOrder, useCompanySidebarNavOrder } from "../hooks/useSidebarMenuOrder";
import { cn } from "../lib/utils";
import { sidebarNavItemTextClass } from "./SidebarSection";

function SortableNavRow({
  id,
  dragDisabled,
  children,
}: {
  id: string;
  dragDisabled: boolean;
  children: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled: dragDisabled,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 2 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn("shrink-0", isDragging && "opacity-70")}
      {...attributes}
    >
      <div className="flex items-stretch gap-0">
        {dragDisabled ? null : (
          <button
            type="button"
            className={cn(
              "flex w-5 shrink-0 cursor-grab touch-none items-center justify-center rounded-sm border-0 bg-transparent p-0",
              "text-muted-foreground/40 hover:bg-black/[0.04] hover:text-muted-foreground/80",
              "active:cursor-grabbing dark:hover:bg-white/[0.06]",
            )}
            aria-label="Drag to reorder"
            {...listeners}
          >
            <GripVertical className="h-3.5 w-3.5" aria-hidden />
          </button>
        )}
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}

type SidebarPrimaryNavProps = {
  liveRunCount: number;
  pluginContext: { companyId: string | null; companyPrefix: string | null };
};

export function SidebarPrimaryNav({ liveRunCount, pluginContext }: SidebarPrimaryNavProps) {
  const { sidebarCompact } = useSidebar();
  const { selectedCompanyId } = useCompany();
  const { data: session } = useQuery({
    queryKey: queryKeys.auth.session,
    queryFn: () => authApi.getSession(),
  });
  const { data: sidebarBadges } = useQuery({
    queryKey: selectedCompanyId ? queryKeys.sidebarBadges(selectedCompanyId) : ["sidebar-badges", "none"],
    queryFn: () => sidebarBadgesApi.get(selectedCompanyId!),
    enabled: Boolean(selectedCompanyId),
    staleTime: 10_000,
  });
  const currentUserId = session?.user?.id ?? session?.session?.userId ?? null;
  const canReadCommandCenter = sidebarBadges?.canReadCommandCenter ?? true;
  const canReadTasks = sidebarBadges?.canReadTasks ?? true;
  const canReadHybridOrg = sidebarBadges?.canReadHybridOrg ?? true;
  const canReadSkills = sidebarBadges?.canReadSkills ?? true;
  const canReadGoals = sidebarBadges?.canReadGoals ?? true;
  const canReadCosts = sidebarBadges?.canReadCosts ?? true;
  const canReadAttentionQueue = sidebarBadges?.canReadAttentionQueue ?? true;
  const canReadTeams = sidebarBadges?.canReadTeams ?? true;

  const availableIds = useMemo((): string[] => {
    const ids: string[] = [...DEFAULT_PRIMARY_NAV_IDS];
    if (SHOW_BETA_UI) ids.push(ROUTINES_NAV_ID);
    return ids;
  }, []);

  const { orderedIds, persistOrder } = usePrimarySidebarNavOrder(
    selectedCompanyId,
    currentUserId,
    availableIds,
  );

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const ids = [...orderedIds];
      const oldIndex = ids.indexOf(active.id as string);
      const newIndex = ids.indexOf(over.id as string);
      if (oldIndex === -1 || newIndex === -1) return;
      persistOrder(arrayMove(ids, oldIndex, newIndex));
    },
    [orderedIds, persistOrder],
  );

  const dragDisabled = sidebarCompact;

  const renderNavItem = (id: string) => {
    switch (id) {
      case "dashboard":
        if (!canReadCommandCenter) return null;
        return (
          <SidebarNavItem
            to="/dashboard"
            label="Command Center"
            icon={LayoutDashboard}
            iconClassName={azureSidebarIcon.dashboard}
            liveCount={liveRunCount}
            className={dragDisabled ? undefined : "!pl-2"}
          />
        );
      case "org":
        if (!canReadHybridOrg) return null;
        return (
          <SidebarNavItem
            to="/org"
            label="Hybrid Org Chart"
            icon={Network}
            iconClassName={azureSidebarIcon.org}
            className={dragDisabled ? undefined : "!pl-2"}
          />
        );
      case "skills":
        if (!canReadSkills) return null;
        return (
          <SidebarNavItem
            to="/skills"
            label="Skills"
            icon={Boxes}
            iconClassName={azureSidebarIcon.skills}
            className={dragDisabled ? undefined : "!pl-2"}
          />
        );
      case "costs":
        if (!canReadCosts) return null;
        return (
          <SidebarNavItem
            to="/costs"
            label="Costs"
            icon={DollarSign}
            iconClassName={azureSidebarIcon.costs}
            className={dragDisabled ? undefined : "!pl-2"}
          />
        );
      case "goals":
        if (!canReadGoals) return null;
        return (
          <SidebarNavItem
            to="/goals"
            label="Goals"
            icon={Target}
            iconClassName={azureSidebarIcon.goals}
            className={dragDisabled ? undefined : "!pl-2"}
          />
        );
      case "inbox":
        if (!canReadAttentionQueue) return null;
        return (
          <SidebarNavItem
            to="/inbox"
            label="Attention Queue"
            icon={Inbox}
            iconClassName={azureSidebarIcon.inbox}
            className={dragDisabled ? undefined : "!pl-2"}
          />
        );
      case "tasks":
        if (!canReadTasks) return null;
        return (
          <SidebarNavItem
            to="/issues"
            label="Tasks"
            icon={CheckSquare}
            iconClassName={azureSidebarIcon.tasks}
            className={dragDisabled ? undefined : "!pl-2"}
          />
        );
      case "team":
        if (!canReadTeams) return null;
        return (
          <SidebarNavItem
            to="/company/people"
            label="Team"
            icon={Users}
            iconClassName={azureSidebarIcon.team}
            className={dragDisabled ? undefined : "!pl-2"}
          />
        );
      case ROUTINES_NAV_ID:
        return SHOW_BETA_UI ? (
          <SidebarNavItem
            to="/routines"
            label="Routines"
            icon={Repeat}
            iconClassName={azureSidebarIcon.routines}
            textBadge="Beta"
            textBadgeTone="amber"
            className={dragDisabled ? undefined : "!pl-2"}
          />
        ) : null;
    }
  };

  return (
    <div className="flex shrink-0 flex-col gap-0.5 pb-0.5 [&>*]:shrink-0">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={orderedIds} strategy={verticalListSortingStrategy}>
          {orderedIds.map((id) => {
            const node = renderNavItem(id);
            if (!node) return null;
            return (
              <SortableNavRow key={id} id={id} dragDisabled={dragDisabled}>
                {node}
              </SortableNavRow>
            );
          })}
        </SortableContext>
      </DndContext>
      <PluginSlotOutlet
        slotTypes={["sidebar"]}
        context={pluginContext}
        className={cn("flex flex-col gap-0.5", sidebarCompact && "items-stretch")}
        itemClassName={cn(
          "font-medium",
          sidebarNavItemTextClass,
          sidebarCompact && "text-center text-[14px] leading-tight",
        )}
        missingBehavior="placeholder"
      />
    </div>
  );
}

const COMPANY_NAV_IDS = ["audit", "billing", "connectors", "settings"] as const;

export function SidebarCompanyNavSection() {
  const { sidebarCompact } = useSidebar();
  const { selectedCompanyId } = useCompany();
  const { data: session } = useQuery({
    queryKey: queryKeys.auth.session,
    queryFn: () => authApi.getSession(),
  });
  const currentUserId = session?.user?.id ?? session?.session?.userId ?? null;
  const { data: sidebarBadges } = useQuery({
    queryKey: selectedCompanyId ? queryKeys.sidebarBadges(selectedCompanyId) : ["sidebar-badges", "none"],
    queryFn: () => sidebarBadgesApi.get(selectedCompanyId!),
    enabled: Boolean(selectedCompanyId),
    staleTime: 10_000,
  });
  const canReadAuditLogs = sidebarBadges?.canReadAuditLogs ?? true;
  const canReadCompanySettings = sidebarBadges?.canReadCompanySettings ?? true;
  const canReadConnectors = sidebarBadges?.canReadConnectors ?? true;

  const availableIds = useMemo(() => [...COMPANY_NAV_IDS], []);
  const { orderedIds, persistOrder } = useCompanySidebarNavOrder(
    selectedCompanyId,
    currentUserId,
    availableIds,
  );

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const ids = [...orderedIds];
      const oldIndex = ids.indexOf(active.id as string);
      const newIndex = ids.indexOf(over.id as string);
      if (oldIndex === -1 || newIndex === -1) return;
      persistOrder(arrayMove(ids, oldIndex, newIndex));
    },
    [orderedIds, persistOrder],
  );

  const dragDisabled = sidebarCompact;

  const renderItem = (id: string) => {
    switch (id) {
      case "audit":
        if (!canReadAuditLogs) return null;
        return (
          <SidebarNavItem
            to="/activity"
            label="Audit Log"
            icon={History}
            iconClassName={azureSidebarIcon.audit}
            textVariant="sub"
            className={dragDisabled ? undefined : "!pl-2"}
          />
        );
      case "billing":
        if (!canReadCompanySettings) return null;
        return (
          <SidebarNavItem
            to="/company/billing"
            label="Billing"
            icon={CreditCard}
            iconClassName={azureSidebarIcon.billing}
            textVariant="sub"
            className={dragDisabled ? undefined : "!pl-2"}
          />
        );
      case "connectors":
        if (!canReadConnectors) return null;
        return (
          <SidebarNavItem
            to="/company/connectors"
            label="Connectors"
            icon={Link2}
            iconClassName={azureSidebarIcon.settings}
            textVariant="sub"
            className={dragDisabled ? undefined : "!pl-2"}
          />
        );
      case "settings":
        if (!canReadCompanySettings) return null;
        return (
          <SidebarNavItem
            to="/company/settings"
            label="Company Settings"
            icon={Settings}
            iconClassName={azureSidebarIcon.settings}
            textVariant="sub"
            className={dragDisabled ? undefined : "!pl-2"}
          />
        );
      default:
        return null;
    }
  };

  return (
    <SidebarSection label="Company">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={orderedIds} strategy={verticalListSortingStrategy}>
          {orderedIds.map((id) => {
            const node = renderItem(id);
            if (!node) return null;
            return (
              <SortableNavRow key={id} id={id} dragDisabled={dragDisabled}>
                {node}
              </SortableNavRow>
            );
          })}
        </SortableContext>
      </DndContext>
    </SidebarSection>
  );
}
