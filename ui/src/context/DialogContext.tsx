import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { useCompany } from "./CompanyContext";
import { agentsApi } from "../api/agents";
import { goalsApi } from "../api/goals";
import { projectsApi } from "../api/projects";
import { ONBOARDING_PROJECT_NAME, selectDefaultCompanyGoalId } from "../lib/onboarding-launch";
import {
  CREATE_AGENT_ISSUE_DESCRIPTION,
  CREATE_AGENT_ISSUE_TITLE,
} from "../lib/issue-presets";

interface NewIssueDefaults {
  status?: string;
  priority?: string;
  projectId?: string;
  assigneeAgentId?: string;
  assigneeUserId?: string;
  title?: string;
  description?: string;
}

interface NewGoalDefaults {
  parentId?: string;
}

interface OnboardingOptions {
  initialStep?: 1 | 2 | 3 | 4;
  companyId?: string;
}

interface DialogContextValue {
  newIssueOpen: boolean;
  newIssueDefaults: NewIssueDefaults;
  openNewIssue: (defaults?: NewIssueDefaults) => void;
  closeNewIssue: () => void;
  newProjectOpen: boolean;
  openNewProject: () => void;
  closeNewProject: () => void;
  newGoalOpen: boolean;
  newGoalDefaults: NewGoalDefaults;
  openNewGoal: (defaults?: NewGoalDefaults) => void;
  closeNewGoal: () => void;
  openNewAgent: () => void;
  onboardingOpen: boolean;
  onboardingOptions: OnboardingOptions;
  openOnboarding: (options?: OnboardingOptions) => void;
  closeOnboarding: () => void;
}

const DialogContext = createContext<DialogContextValue | null>(null);

export function DialogProvider({ children }: { children: ReactNode }) {
  const { selectedCompanyId } = useCompany();
  const [newIssueOpen, setNewIssueOpen] = useState(false);
  const [newIssueDefaults, setNewIssueDefaults] = useState<NewIssueDefaults>({});
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [newGoalOpen, setNewGoalOpen] = useState(false);
  const [newGoalDefaults, setNewGoalDefaults] = useState<NewGoalDefaults>({});
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [onboardingOptions, setOnboardingOptions] = useState<OnboardingOptions>({});

  const openNewIssue = useCallback((defaults: NewIssueDefaults = {}) => {
    setNewIssueDefaults(defaults);
    setNewIssueOpen(true);
  }, []);

  const closeNewIssue = useCallback(() => {
    setNewIssueOpen(false);
    setNewIssueDefaults({});
  }, []);

  const openNewProject = useCallback(() => {
    setNewProjectOpen(true);
  }, []);

  const closeNewProject = useCallback(() => {
    setNewProjectOpen(false);
  }, []);

  const openNewGoal = useCallback((defaults: NewGoalDefaults = {}) => {
    setNewGoalDefaults(defaults);
    setNewGoalOpen(true);
  }, []);

  const closeNewGoal = useCallback(() => {
    setNewGoalOpen(false);
    setNewGoalDefaults({});
  }, []);

  const openNewAgent = useCallback(() => {
    void (async () => {
      if (!selectedCompanyId) {
        openNewIssue({
          title: CREATE_AGENT_ISSUE_TITLE,
          description: CREATE_AGENT_ISSUE_DESCRIPTION,
        });
        return;
      }
      let defaultProjectId: string | undefined;
      let assigneeAgentId: string | undefined;
      try {
        const [agents, goals] = await Promise.all([
          agentsApi.list(selectedCompanyId),
          goalsApi.list(selectedCompanyId),
        ]);
        assigneeAgentId = agents.find((a) => a.role === "ceo")?.id;
        const firstGoalId = selectDefaultCompanyGoalId(goals);
        const projects = await projectsApi.list(selectedCompanyId);
        const aiAdminProject =
          projects.find(
            (project) => project.name === ONBOARDING_PROJECT_NAME && !project.archivedAt,
          ) ?? projects.find((project) => project.name === ONBOARDING_PROJECT_NAME);
        const defaultProject =
          aiAdminProject ??
          projects.find(
            (project) => firstGoalId && project.goalIds.includes(firstGoalId),
          ) ??
          projects.find((project) => !project.archivedAt) ??
          projects[0] ??
          null;
        defaultProjectId = defaultProject?.id;
      } catch {
        // Keep flow usable; user can pick project and assignee manually.
      }
      openNewIssue({
        assigneeAgentId,
        status: "todo",
        title: CREATE_AGENT_ISSUE_TITLE,
        description: CREATE_AGENT_ISSUE_DESCRIPTION,
        ...(defaultProjectId ? { projectId: defaultProjectId } : {}),
      });
    })();
  }, [selectedCompanyId, openNewIssue]);

  const openOnboarding = useCallback((options: OnboardingOptions = {}) => {
    setOnboardingOptions(options);
    setOnboardingOpen(true);
  }, []);

  const closeOnboarding = useCallback(() => {
    setOnboardingOpen(false);
    setOnboardingOptions({});
  }, []);

  return (
    <DialogContext.Provider
      value={{
        newIssueOpen,
        newIssueDefaults,
        openNewIssue,
        closeNewIssue,
        newProjectOpen,
        openNewProject,
        closeNewProject,
        newGoalOpen,
        newGoalDefaults,
        openNewGoal,
        closeNewGoal,
        openNewAgent,
        onboardingOpen,
        onboardingOptions,
        openOnboarding,
        closeOnboarding,
      }}
    >
      {children}
    </DialogContext.Provider>
  );
}

export function useDialog() {
  const ctx = useContext(DialogContext);
  if (!ctx) {
    throw new Error("useDialog must be used within DialogProvider");
  }
  return ctx;
}
