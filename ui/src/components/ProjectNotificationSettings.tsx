import { useEffect, useState } from "react";
import type {
  Project,
  ProjectIssueStatus,
  ProjectNotificationConfig,
  ProjectNotificationEventType,
  ProjectNotificationRecipientRole,
  ProjectNotificationRule,
} from "@paperclipai/shared";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ProjectFieldSaveState } from "./ProjectProperties";

/** Keep aligned with server `defaultNotificationConfig` in `issue-notifications.ts`. */
function defaultNotificationConfig(): ProjectNotificationConfig {
  return {
    enabled: true,
    defaultChannels: ["email"],
    rules: {
      "issue.status_changed": {
        enabled: true,
        notifyRoles: ["issue_assignee_user", "issue_creator_user"],
      },
      "issue.comment_added": {
        enabled: true,
        notifyRoles: ["issue_assignee_user", "issue_creator_user"],
      },
      "issue.assigned": {
        enabled: true,
        notifyRoles: ["issue_assignee_user", "issue_creator_user"],
      },
    },
  };
}

function mergeForDisplay(stored: Project["notificationConfig"]): ProjectNotificationConfig {
  const d = defaultNotificationConfig();
  if (!stored) return d;
  return {
    ...d,
    ...stored,
    rules: {
      ...d.rules,
      ...stored.rules,
    },
  };
}

function normalizeForSave(draft: ProjectNotificationConfig): ProjectNotificationConfig | null {
  const defaults = defaultNotificationConfig();
  if (JSON.stringify(draft) === JSON.stringify(defaults)) {
    return null;
  }
  return draft;
}

const EVENT_META: Array<{
  key: ProjectNotificationEventType;
  label: string;
  description: string;
}> = [
  {
    key: "issue.status_changed",
    label: "Status changes",
    description: "When an issue moves to a different workflow state.",
  },
  {
    key: "issue.comment_added",
    label: "New comments",
    description: "When someone adds a comment on an issue.",
  },
  {
    key: "issue.assigned",
    label: "Assignments",
    description: "When a human assignee is set or changed.",
  },
];

const ROLE_LABELS: Record<ProjectNotificationRecipientRole, string> = {
  issue_assignee_user: "Human assignee",
  issue_creator_user: "Human who created the issue",
};

function ruleFor(
  config: ProjectNotificationConfig,
  event: ProjectNotificationEventType,
  defaults: ProjectNotificationConfig,
) {
  const base = defaults.rules?.[event] ?? {};
  return { ...base, ...config.rules?.[event] };
}

function setRule(
  config: ProjectNotificationConfig,
  event: ProjectNotificationEventType,
  patch: Partial<ProjectNotificationRule>,
  defaults: ProjectNotificationConfig,
): ProjectNotificationConfig {
  const prev = ruleFor(config, event, defaults);
  return {
    ...config,
    rules: {
      ...config.rules,
      [event]: { ...prev, ...patch },
    },
  };
}

function toggleRole(
  current: ProjectNotificationRecipientRole[] | undefined,
  role: ProjectNotificationRecipientRole,
  on: boolean,
): ProjectNotificationRecipientRole[] {
  const set = new Set(current ?? ["issue_assignee_user", "issue_creator_user"]);
  if (on) set.add(role);
  else set.delete(role);
  return Array.from(set) as ProjectNotificationRecipientRole[];
}

function toggleStatusFilter(
  current: string[] | undefined,
  value: string,
  on: boolean,
): string[] | undefined {
  const set = new Set(current ?? []);
  if (on) set.add(value);
  else set.delete(value);
  const arr = Array.from(set);
  return arr.length === 0 ? undefined : arr;
}

interface ProjectNotificationSettingsProps {
  project: Project;
  issueStatuses: ProjectIssueStatus[];
  onSave: (data: { notificationConfig: ProjectNotificationConfig | null }) => Promise<void>;
  saveState: ProjectFieldSaveState;
  /** When true, omit the section title and intro (e.g. inside a dialog that provides its own header). */
  embeddedInModal?: boolean;
}

export function ProjectNotificationSettings({
  project,
  issueStatuses,
  onSave,
  saveState,
  embeddedInModal = false,
}: ProjectNotificationSettingsProps) {
  const defaults = defaultNotificationConfig();
  const [draft, setDraft] = useState(() => mergeForDisplay(project.notificationConfig));

  useEffect(() => {
    setDraft(mergeForDisplay(project.notificationConfig));
  }, [project.id, project.notificationConfig]);

  const busy = saveState === "saving";
  const activeStatuses = issueStatuses.filter((s) => s.isActive);

  async function handleSave() {
    const payload = normalizeForSave(draft);
    await onSave({ notificationConfig: payload });
  }

  async function handleClear() {
    setDraft(defaults);
    await onSave({ notificationConfig: null });
  }

  return (
    <section className={embeddedInModal ? "space-y-0" : "space-y-4"}>
      {!embeddedInModal ? (
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Bell className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold">Task notifications</h3>
            </div>
            <p className="max-w-xl text-xs leading-relaxed text-muted-foreground">
              Choose which task events trigger alerts for this project. Team members can still manage their own preferences in{" "}
              <span className="text-foreground/90">Account → Notifications</span>. In-app alerts are sent when a rule matches. Email is sent only when email is enabled here, company email delivery is configured, and the recipient has email notifications turned on.
            </p>
          </div>
        </div>
      ) : null}

      <div
        className={
          embeddedInModal
            ? "space-y-4"
            : "rounded-lg border border-border bg-card px-4 py-4 space-y-4"
        }
      >
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={draft.enabled !== false}
            onChange={(e) => setDraft((c) => ({ ...c, enabled: e.target.checked }))}
            disabled={busy}
          />
          Enable notifications for this project
        </label>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={(draft.defaultChannels ?? ["email"]).includes("email")}
            onChange={(e) =>
              setDraft((c) => ({
                ...c,
                defaultChannels: e.target.checked ? ["email"] : [],
              }))
            }
            disabled={busy || draft.enabled === false}
          />
          Allow email (when users have email enabled)
        </label>

        <div className="space-y-3 border-t border-border pt-3">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Events</p>
          {EVENT_META.map(({ key, label, description }) => {
            const r = ruleFor(draft, key, defaults);
            const statusRule = key === "issue.status_changed";
            return (
              <div key={key} className="rounded-md border border-border/80 px-3 py-3 space-y-2">
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={r.enabled !== false}
                    onChange={(e) =>
                      setDraft((c) => setRule(c, key, { enabled: e.target.checked }, defaults))
                    }
                    disabled={busy}
                  />
                  <span>
                    <span className="font-medium">{label}</span>
                    <span className="block text-xs text-muted-foreground font-normal">{description}</span>
                  </span>
                </label>

                {r.enabled !== false ? (
                  <div className="ml-6 space-y-2 border-l border-border pl-3">
                    <p className="text-[11px] text-muted-foreground">Notify</p>
                    {(Object.keys(ROLE_LABELS) as ProjectNotificationRecipientRole[]).map((role) => (
                      <label key={role} className="flex items-center gap-2 text-xs">
                        <input
                          type="checkbox"
                          checked={(r.notifyRoles ?? ["issue_assignee_user", "issue_creator_user"]).includes(role)}
                          onChange={(e) =>
                            setDraft((c) =>
                              setRule(
                                c,
                                key,
                                {
                                  notifyRoles: toggleRole(r.notifyRoles, role, e.target.checked),
                                },
                                defaults,
                              ),
                            )
                          }
                          disabled={busy}
                        />
                        {ROLE_LABELS[role]}
                      </label>
                    ))}

                    <label className="flex items-center gap-2 text-xs pt-1">
                      <input
                        type="checkbox"
                        checked={Boolean(r.onlyIfActorIsAgent)}
                        onChange={(e) =>
                          setDraft((c) =>
                            setRule(c, key, { onlyIfActorIsAgent: e.target.checked }, defaults),
                          )
                        }
                        disabled={busy}
                      />
                      Only when the actor is an agent
                    </label>

                    {statusRule ? (
                      <div className="pt-1 space-y-1">
                        <p className="text-[11px] text-muted-foreground">
                          Only when moving to these states (leave all unchecked for any status change)
                        </p>
                        {activeStatuses.length === 0 ? (
                          <p className="text-[11px] text-muted-foreground italic">
                            No active issue statuses yet. Configure them on the Workflow tab.
                          </p>
                        ) : (
                          <div className="flex flex-wrap gap-x-3 gap-y-1">
                            {activeStatuses.map((s) => (
                              <label key={s.id} className="flex items-center gap-1.5 text-xs">
                                <input
                                  type="checkbox"
                                  checked={(r.statuses ?? []).includes(s.value)}
                                  onChange={(e) =>
                                    setDraft((c) =>
                                      setRule(
                                        c,
                                        key,
                                        {
                                          statuses: toggleStatusFilter(r.statuses, s.value, e.target.checked),
                                        },
                                        defaults,
                                      ),
                                    )
                                  }
                                  disabled={busy}
                                />
                                <span className="truncate max-w-[140px]" title={s.name}>
                                  {s.name}
                                </span>
                              </label>
                            ))}
                          </div>
                        )}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
          <Button type="button" size="sm" className="h-8" onClick={() => void handleSave()} disabled={busy}>
            Save notification settings
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8"
            onClick={() => void handleClear()}
            disabled={busy}
          >
            Clear custom config
          </Button>
          {saveState === "saved" ? (
            <span className="text-xs text-green-600 dark:text-green-400">Saved</span>
          ) : null}
          {saveState === "error" ? (
            <span className="text-xs text-destructive">Save failed — try again</span>
          ) : null}
        </div>
      </div>
    </section>
  );
}
