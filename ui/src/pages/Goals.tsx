import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { goalsApi } from "../api/goals";
import { projectsApi } from "../api/projects";
import { sidebarBadgesApi } from "../api/sidebarBadges";
import { useCompany } from "../context/CompanyContext";
import { useDialog } from "../context/DialogContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { GoalsList } from "../components/GoalsList";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import { Target } from "lucide-react";

export function Goals() {
  const { selectedCompanyId } = useCompany();
  const { openNewGoal } = useDialog();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();

  useEffect(() => {
    setBreadcrumbs([{ label: "Goals" }]);
  }, [setBreadcrumbs]);

  const { data: goals, isLoading, error } = useQuery({
    queryKey: queryKeys.goals.list(selectedCompanyId!),
    queryFn: () => goalsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

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
  const canReadGoals = sidebarBadges?.canReadGoals ?? true;
  const canWriteGoals = sidebarBadges?.canWriteGoals ?? true;

  const updateGoal = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      goalsApi.update(id, data),
    onSuccess: () => {
      if (selectedCompanyId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.goals.list(selectedCompanyId) });
      }
    },
  });

  if (!selectedCompanyId) {
    return <EmptyState icon={Target} message="Select a company to view goals." />;
  }

  if (isLoading) {
    return <PageSkeleton variant="list" />;
  }

  if (!canReadGoals) {
    return (
      <div className="rounded-2xl border border-border/60 bg-card px-5 py-6 text-sm text-muted-foreground shadow-sm ring-1 ring-border/30">
        <div className="font-medium text-foreground">You do not have permission to view Goals.</div>
        <div className="mt-2">
          Ask a company admin for the <code>goals.read</code> permission.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {(goals?.length ?? 0) > 0 ? (
        <GoalsList
          goals={goals ?? []}
          projects={projects ?? []}
          error={error as Error | null}
          canWriteGoals={canWriteGoals}
          onUpdateGoal={(id, data) => updateGoal.mutate({ id, data })}
          onNewGoal={() => openNewGoal()}
        />
      ) : null}

      {!error && (goals?.length ?? 0) === 0 ? (
        <EmptyState
          icon={Target}
          message="No goals yet."
          action={canWriteGoals ? "Add Goal" : undefined}
          onAction={canWriteGoals ? () => openNewGoal() : undefined}
        />
      ) : null}
    </div>
  );
}
