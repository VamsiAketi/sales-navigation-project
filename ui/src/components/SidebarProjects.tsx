import { useCallback, useMemo, useState } from "react";
import { Link, NavLink, useLocation } from "@/lib/router";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Folder, FolderKanban, Plus } from "lucide-react";
import {
  DndContext,
  MouseSensor,
  closestCenter,
  type DragEndEvent,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useCompany } from "../context/CompanyContext";
import { useDialog } from "../context/DialogContext";
import { useSidebar } from "../context/SidebarContext";
import { authApi } from "../api/auth";
import { projectsApi } from "../api/projects";
import { sidebarBadgesApi } from "../api/sidebarBadges";
import { queryKeys } from "../lib/queryKeys";
import { cn, projectRouteRef } from "../lib/utils";
import { useProjectOrder } from "../hooks/useProjectOrder";
import { BudgetSidebarMarker } from "./BudgetSidebarMarker";
import {
  sidebarNavCollapsibleGroupClass,
  sidebarNavSubItemTextClass,
} from "./SidebarSection";
import { azureProjectStatusIconClass, azureSidebarIcon } from "../lib/sidebar-icon-tints";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { PluginSlotMount, usePluginSlots } from "@/plugins/slots";
import type { Project } from "@paperclipai/shared";

type ProjectSidebarSlot = ReturnType<typeof usePluginSlots>["slots"][number];

function SortableProjectItem({
  activeProjectRef,
  companyId,
  companyPrefix,
  isMobile,
  project,
  projectSidebarSlots,
  setSidebarOpen,
}: {
  activeProjectRef: string | null;
  companyId: string | null;
  companyPrefix: string | null;
  isMobile: boolean;
  project: Project;
  projectSidebarSlots: ProjectSidebarSlot[];
  setSidebarOpen: (open: boolean) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: project.id });

  const routeRef = projectRouteRef(project);
  const isActive = activeProjectRef === routeRef || activeProjectRef === project.id;

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 10 : undefined,
      }}
      className={cn(isDragging && "opacity-80")}
      {...attributes}
      {...listeners}
    >
      <div className="flex flex-col gap-0.5">
        <NavLink
          to={`/projects/${routeRef}/issues`}
          onClick={() => {
            if (isMobile) setSidebarOpen(false);
          }}
          className={cn(
            // Azure portal–style nav: left accent on active, neutral hover (Fluent list / Hub menu).
            sidebarNavSubItemTextClass,
            "flex items-center gap-2.5 rounded-sm py-1.5 pl-2 pr-3 transition-colors border-l-2 -ml-px",
            isActive
              ? "border-[#0078d4] bg-[#edebe9] text-[#201f1e] dark:border-[#0078d4] dark:bg-[var(--sidebar-active-bg)] dark:text-foreground"
              : "border-transparent text-[#323130] hover:bg-[#f3f2f1] dark:text-foreground/85 dark:hover:bg-white/[0.06]",
          )}
        >
          <span
            className="inline-flex shrink-0"
            title={`Project status: ${project.status.replace(/_/g, " ")}`}
          >
            <Folder
              className={cn(
                "h-3.5 w-3.5 stroke-[1.5]",
                azureProjectStatusIconClass(project.status),
              )}
              aria-hidden
            />
          </span>
          <span className="flex-1 truncate">{project.name}</span>
          {project.pauseReason === "budget" ? <BudgetSidebarMarker title="Project paused by budget" /> : null}
        </NavLink>
        {projectSidebarSlots.length > 0 && (
          <div className="ml-5 flex flex-col gap-0.5">
            {projectSidebarSlots.map((slot) => (
              <PluginSlotMount
                key={`${project.id}:${slot.pluginKey}:${slot.id}`}
                slot={slot}
                context={{
                  companyId,
                  companyPrefix,
                  projectId: project.id,
                  projectRef: routeRef,
                  entityId: project.id,
                  entityType: "project",
                }}
                missingBehavior="placeholder"
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function SidebarProjects() {
  const [open, setOpen] = useState(true);
  const { selectedCompany, selectedCompanyId } = useCompany();
  const { openNewProject } = useDialog();
  const { isMobile, setSidebarOpen, sidebarCompact } = useSidebar();
  const location = useLocation();

  const { data: projects } = useQuery({
    queryKey: queryKeys.projects.list(selectedCompanyId!),
    queryFn: () => projectsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });
  const { data: sidebarBadges } = useQuery({
    queryKey: selectedCompanyId ? queryKeys.sidebarBadges(selectedCompanyId) : ["sidebar-badges", "none"],
    queryFn: () => sidebarBadgesApi.get(selectedCompanyId!),
    enabled: Boolean(selectedCompanyId),
    staleTime: 10_000,
  });
  const canCreateProjects = sidebarBadges?.canCreateProjects ?? false;
  const { data: session } = useQuery({
    queryKey: queryKeys.auth.session,
    queryFn: () => authApi.getSession(),
  });
  const { slots: projectSidebarSlots } = usePluginSlots({
    slotTypes: ["projectSidebarItem"],
    entityType: "project",
    companyId: selectedCompanyId,
    enabled: !!selectedCompanyId,
  });

  const currentUserId = session?.user?.id ?? session?.session?.userId ?? null;

  const visibleProjects = useMemo(
    () => (projects ?? []).filter((project: Project) => !project.archivedAt),
    [projects],
  );
  const { orderedProjects, persistOrder } = useProjectOrder({
    projects: visibleProjects,
    companyId: selectedCompanyId,
    userId: currentUserId,
  });

  const projectMatch = location.pathname.match(/^\/(?:[^/]+\/)?projects\/([^/]+)/);
  const activeProjectRef = projectMatch?.[1] ?? null;
  const projectsSectionActive = /^\/(?:[^/]+\/)?projects(?:\/|$)/.test(location.pathname);
  const sensors = useSensors(
    // Project reordering is intentionally desktop-only; touch should remain tap/scroll behavior.
    useSensor(MouseSensor, {
      activationConstraint: { distance: 8 },
    }),
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const ids = orderedProjects.map((project) => project.id);
      const oldIndex = ids.indexOf(active.id as string);
      const newIndex = ids.indexOf(over.id as string);
      if (oldIndex === -1 || newIndex === -1) return;

      persistOrder(arrayMove(ids, oldIndex, newIndex));
    },
    [orderedProjects, persistOrder],
  );

  if (sidebarCompact) return null;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="group">
        <div className="flex items-stretch gap-0">
          <CollapsibleTrigger className="flex w-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground/40 hover:bg-black/[0.04] hover:text-muted-foreground/80 dark:hover:bg-white/[0.06]">
            <ChevronRight
              className={cn(
                "h-3.5 w-3.5 transition-transform",
                open && "rotate-90"
              )}
            />
          </CollapsibleTrigger>
          <div
            className={cn(
              "group/nav flex flex-1 items-center transition-[background-color,color,border-color] duration-100 outline-none",
              sidebarNavCollapsibleGroupClass,
              "mx-0 gap-2.5 border-l-[3px] border-transparent py-2 pl-2 pr-2.5",
              projectsSectionActive
                ? "border-l-[var(--sidebar-active-bar)] bg-[var(--sidebar-active-bg)] text-foreground"
                : "text-sidebar-foreground hover:bg-black/[0.04] dark:hover:bg-white/[0.06]",
            )}
          >
            <Link
              to="/projects"
              className="flex min-w-0 flex-1 items-center gap-2.5"
              onClick={() => {
                if (isMobile) setSidebarOpen(false);
              }}
            >
              <FolderKanban
                className={cn(
                  "h-4 w-4 shrink-0",
                  projectsSectionActive ? "text-[var(--sidebar-active-bar)]" : azureSidebarIcon.projects,
                )}
              />
              <span className="flex-1 truncate">Projects</span>
            </Link>
            {canCreateProjects ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  openNewProject();
                }}
                className="flex items-center justify-center h-4 w-4 rounded text-muted-foreground/70 hover:text-foreground hover:bg-accent/50 transition-colors"
                aria-label="New project"
              >
                <Plus className="h-3 w-3" />
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <CollapsibleContent>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={orderedProjects.map((project) => project.id)}
            strategy={verticalListSortingStrategy}
          >
            <div className="mt-0.5 flex flex-col gap-0.5 pl-[calc(1.25rem+0.5rem+1rem+0.625rem)]">
              {orderedProjects.map((project: Project) => (
                <SortableProjectItem
                  key={project.id}
                  activeProjectRef={activeProjectRef}
                  companyId={selectedCompanyId}
                  companyPrefix={selectedCompany?.issuePrefix ?? null}
                  isMobile={isMobile}
                  project={project}
                  projectSidebarSlots={projectSidebarSlots}
                  setSidebarOpen={setSidebarOpen}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      </CollapsibleContent>
    </Collapsible>
  );
}
