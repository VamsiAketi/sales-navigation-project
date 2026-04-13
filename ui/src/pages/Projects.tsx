import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { projectsApi } from "../api/projects";
import { useCompany } from "../context/CompanyContext";
import { useDialog } from "../context/DialogContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useToast } from "../context/ToastContext";
import { queryKeys } from "../lib/queryKeys";
import { EntityRow } from "../components/EntityRow";
import { ProjectStatusPicker } from "../components/ProjectStatusPicker";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import { formatDate, projectUrl } from "../lib/utils";
import { Button } from "@/components/ui/button";
import { Archive, ChevronRight, Hexagon, Plus } from "lucide-react";

export function Projects() {
  const { selectedCompanyId } = useCompany();
  const { openNewProject } = useDialog();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();
  const { pushToast } = useToast();
  const [showArchived, setShowArchived] = useState(false);

  const updateProjectStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      projectsApi.update(id, { status }, selectedCompanyId ?? undefined),
    onSuccess: (_data, variables) => {
      if (selectedCompanyId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.projects.list(selectedCompanyId) });
      }
      queryClient.invalidateQueries({ queryKey: queryKeys.projects.detail(variables.id) });
    },
    onError: (err: Error) => {
      pushToast({
        title: "Could not update project status",
        body: err.message,
        tone: "error",
      });
    },
  });

  useEffect(() => {
    setBreadcrumbs([{ label: "Projects" }]);
  }, [setBreadcrumbs]);

  const { data: allProjects, isLoading, error } = useQuery({
    queryKey: queryKeys.projects.list(selectedCompanyId!),
    queryFn: () => projectsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const projects = useMemo(
    () => (allProjects ?? []).filter((p) => !p.archivedAt),
    [allProjects],
  );

  const archivedProjects = useMemo(
    () => (allProjects ?? []).filter((p) => !!p.archivedAt),
    [allProjects],
  );

  if (!selectedCompanyId) {
    return <EmptyState icon={Hexagon} message="Select a company to view projects." />;
  }

  if (isLoading) {
    return <PageSkeleton variant="list" />;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <Button size="sm" variant="outline" onClick={openNewProject}>
          <Plus className="h-4 w-4 mr-1" />
          Add Project
        </Button>
      </div>

      {error && <p className="text-sm text-destructive">{error.message}</p>}

      {!isLoading && projects.length === 0 && archivedProjects.length === 0 && (
        <EmptyState
          icon={Hexagon}
          message="No projects yet."
          action="Add Project"
          onAction={openNewProject}
        />
      )}

      {projects.length > 0 && (
        <div className="border border-border">
          {projects.map((project) => (
            <EntityRow
              key={project.id}
              title={project.name}
              subtitle={project.description ?? undefined}
              to={projectUrl(project)}
              trailing={
                <div className="flex items-center gap-3">
                  {project.targetDate && (
                    <span className="text-xs text-muted-foreground">
                      {formatDate(project.targetDate)}
                    </span>
                  )}
                  <span
                    className="shrink-0"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    onPointerDown={(e) => e.stopPropagation()}
                  >
                    <ProjectStatusPicker
                      status={project.status}
                      disabled={
                        updateProjectStatus.isPending &&
                        updateProjectStatus.variables?.id === project.id
                      }
                      onChange={(status) => {
                        if (status !== project.status) {
                          updateProjectStatus.mutate({ id: project.id, status });
                        }
                      }}
                    />
                  </span>
                </div>
              }
            />
          ))}
        </div>
      )}

      {archivedProjects.length > 0 && (
        <div className="space-y-2">
          <button
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            onClick={() => setShowArchived((v) => !v)}
          >
            <ChevronRight
              className={`h-3.5 w-3.5 shrink-0 transition-transform ${showArchived ? "rotate-90" : ""}`}
            />
            <Archive className="h-3.5 w-3.5 shrink-0" />
            <span className="font-medium">
              Archived Projects
            </span>
            <span className="ml-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              {archivedProjects.length}
            </span>
          </button>

          {showArchived && (
            <div className="border border-border opacity-70">
              {archivedProjects.map((project) => (
                <EntityRow
                  key={project.id}
                  title={project.name}
                  subtitle={project.description ?? undefined}
                  to={projectUrl(project)}
                  trailing={
                    <div className="flex items-center gap-3">
                      <span className="rounded-full border border-amber-300/60 bg-amber-50/60 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:border-amber-700/40 dark:bg-amber-950/30 dark:text-amber-400">
                        Archived
                      </span>
                      {project.targetDate && (
                        <span className="text-xs text-muted-foreground">
                          {formatDate(project.targetDate)}
                        </span>
                      )}
                      <span
                        className="shrink-0"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                        }}
                        onPointerDown={(e) => e.stopPropagation()}
                      >
                        <ProjectStatusPicker
                          status={project.status}
                          disabled={
                            updateProjectStatus.isPending &&
                            updateProjectStatus.variables?.id === project.id
                          }
                          onChange={(status) => {
                            if (status !== project.status) {
                              updateProjectStatus.mutate({ id: project.id, status });
                            }
                          }}
                        />
                      </span>
                    </div>
                  }
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
