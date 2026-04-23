import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { goalsApi } from "../api/goals";
import { sidebarBadgesApi } from "../api/sidebarBadges";
import { useCompany } from "../context/CompanyContext";
import { useDialog } from "../context/DialogContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { GoalTree } from "../components/GoalTree";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import { Button } from "@/components/ui/button";
import { Target, Plus } from "lucide-react";

export function Goals() {
  const { selectedCompanyId } = useCompany();
  const { openNewGoal } = useDialog();
  const { setBreadcrumbs } = useBreadcrumbs();

  useEffect(() => {
    setBreadcrumbs([{ label: "Goals" }]);
  }, [setBreadcrumbs]);

  const { data: goals, isLoading, error } = useQuery({
    queryKey: queryKeys.goals.list(selectedCompanyId!),
    queryFn: () => goalsApi.list(selectedCompanyId!),
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
      {error && <p className="text-sm text-destructive">{error.message}</p>}

      {goals && goals.length === 0 && (
        <EmptyState
          icon={Target}
          message="No goals yet."
          action={canWriteGoals ? "Add Goal" : undefined}
          onAction={canWriteGoals ? () => openNewGoal() : undefined}
        />
      )}

      {goals && goals.length > 0 && (
        <>
          {canWriteGoals ? (
            <div className="flex items-center justify-start">
              <Button size="sm" variant="outline" onClick={() => openNewGoal()}>
                <Plus className="h-3.5 w-3.5 mr-1.5" />
                New Goal
              </Button>
            </div>
          ) : null}
          <GoalTree goals={goals} goalLink={(goal) => `/goals/${goal.id}`} />
        </>
      )}
    </div>
  );
}
