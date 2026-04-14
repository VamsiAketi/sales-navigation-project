import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, Eye, EyeOff, KeyRound, Mail, User, X, Pencil, Check } from "lucide-react";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { PageTabBar } from "@/components/PageTabBar";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useNavigate } from "@/lib/router";
import { authApi } from "../api/auth";
import { queryKeys } from "../lib/queryKeys";
import { cn } from "../lib/utils";

// ---------------------------------------------------------------------------
// Password strength
// ---------------------------------------------------------------------------

type PasswordStrength = "weak" | "fair" | "good" | "strong";

function evaluatePasswordStrength(password: string) {
  const checks = [
    { label: "At least 8 characters", passed: password.length >= 8 },
    { label: "Uppercase letter", passed: /[A-Z]/.test(password) },
    { label: "Lowercase letter", passed: /[a-z]/.test(password) },
    { label: "Number", passed: /[0-9]/.test(password) },
    { label: "Special character (!@#$%…)", passed: /[^A-Za-z0-9]/.test(password) },
  ];
  const score = checks.filter((c) => c.passed).length;
  const level: PasswordStrength =
    score <= 1 ? "weak" : score === 2 ? "fair" : score === 3 ? "good" : "strong";
  const label =
    level === "weak" ? "Weak" : level === "fair" ? "Fair" : level === "good" ? "Good" : "Strong";
  return { level, score, label, checks };
}

const strengthBarColor: Record<PasswordStrength, string> = {
  weak: "bg-destructive",
  fair: "bg-orange-400",
  good: "bg-yellow-400",
  strong: "bg-green-500",
};

const strengthLabelColor: Record<PasswordStrength, string> = {
  weak: "text-destructive",
  fair: "text-orange-400",
  good: "text-yellow-500",
  strong: "text-green-500",
};

function PasswordStrengthMeter({ password }: { password: string }) {
  if (!password) return null;
  const { level, score, label, checks } = evaluatePasswordStrength(password);
  return (
    <div className="mt-2 space-y-2">
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            className={cn(
              "h-1 flex-1 rounded-full transition-all duration-200",
              i <= score ? strengthBarColor[level] : "bg-border",
            )}
          />
        ))}
      </div>
      <p className={cn("text-xs font-medium", strengthLabelColor[level])}>{label}</p>
      <ul className="space-y-0.5">
        {checks.map((c) => (
          <li key={c.label} className={cn("text-xs", c.passed ? "text-muted-foreground" : "text-destructive/80")}>
            {c.passed ? "✓" : "✗"} {c.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Form field helpers
// ---------------------------------------------------------------------------

function ReadOnlyField({ id, label, value }: { id: string; label: string; value: string }) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-xs text-muted-foreground block">
        {label}
      </label>
      <input
        id={id}
        type="text"
        value={value}
        readOnly
        className="w-full rounded-md border border-border bg-muted/30 px-3 py-2 text-sm outline-none cursor-default text-foreground/80"
      />
    </div>
  );
}

function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete,
  disabled,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete?: string;
  disabled?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-xs text-muted-foreground block">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={visible ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          disabled={disabled}
          className={cn(
            "w-full rounded-md border border-border bg-transparent px-3 py-2 pr-10 text-sm outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50",
            disabled && "opacity-50 cursor-not-allowed",
          )}
        />
        <button
          type="button"
          tabIndex={-1}
          onClick={() => setVisible((v) => !v)}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
          aria-label={visible ? "Hide password" : "Show password"}
        >
          {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Editable profile field
// ---------------------------------------------------------------------------

function EditableField({
  id,
  label,
  value,
  type = "text",
  disabled,
  onSave,
}: {
  id: string;
  label: string;
  value: string;
  type?: string;
  disabled?: boolean;
  onSave: (value: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Keep draft in sync if parent value changes (e.g. after save)
  useEffect(() => { if (!editing) setDraft(value); }, [value, editing]);

  async function handleSave() {
    const trimmed = draft.trim();
    if (!trimmed || trimmed === value) { setEditing(false); return; }
    setSaving(true);
    setError(null);
    try {
      await onSave(trimmed);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-xs text-muted-foreground block">{label}</label>
      <div className="flex items-center gap-2">
        {editing ? (
          <>
            <input
              id={id}
              type={type}
              value={draft}
              autoFocus
              disabled={saving || disabled}
              onChange={(e) => { setDraft(e.target.value); setError(null); }}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSave();
                if (e.key === "Escape") { setEditing(false); setDraft(value); setError(null); }
              }}
              className="flex-1 rounded-md border border-ring bg-transparent px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50 disabled:opacity-50"
            />
            <button
              onClick={handleSave}
              disabled={saving || disabled}
              title="Save"
              className="shrink-0 h-8 w-8 flex items-center justify-center rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              <Check className="h-4 w-4" />
            </button>
          </>
        ) : (
          <>
            <input
              id={id}
              type={type}
              value={value || "—"}
              readOnly
              className="flex-1 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm outline-none cursor-default text-foreground/80"
            />
            <button
              onClick={() => { setEditing(true); setDraft(value); }}
              disabled={disabled}
              title={`Edit ${label.toLowerCase()}`}
              className="shrink-0 h-8 w-8 flex items-center justify-center rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-50"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          </>
        )}
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Personal Details tab
// ---------------------------------------------------------------------------

function PersonalDetailsTab({ name, email }: { name: string | null; email: string | null }) {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (input: { name?: string; email?: string }) => authApi.updateProfile(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.auth.session }),
  });

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <User className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-lg font-semibold">Personal Details</h2>
        </div>
        <p className="text-sm text-muted-foreground">Your profile information on this instance.</p>
      </div>

      <section className="rounded-xl border border-border bg-card p-5 space-y-4 max-w-lg">
        <EditableField
          id="pd-name"
          label="Name"
          value={name ?? ""}
          disabled={mutation.isPending}
          onSave={(value) => mutation.mutateAsync({ name: value })}
        />
        <EditableField
          id="pd-email"
          label="Email"
          value={email ?? ""}
          type="email"
          disabled={mutation.isPending}
          onSave={(value) => mutation.mutateAsync({ email: value })}
        />
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Account Details tab
// ---------------------------------------------------------------------------

function ChangePasswordForm() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const strength = evaluatePasswordStrength(newPassword);

  const mutation = useMutation({
    mutationFn: () => authApi.changePassword({ currentPassword, newPassword }),
    onSuccess: () => {
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setValidationError(null);
      setSuccessMessage("Password changed successfully.");
    },
    onError: (err) => {
      setValidationError(err instanceof Error ? err.message : "Failed to change password.");
      setSuccessMessage(null);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSuccessMessage(null);

    if (!currentPassword) {
      setValidationError("Current password is required.");
      return;
    }
    if (!newPassword) {
      setValidationError("New password is required.");
      return;
    }
    if (strength.score < 3) {
      setValidationError("New password is too weak. Please meet at least 3 of the 5 requirements.");
      return;
    }
    if (newPassword === currentPassword) {
      setValidationError("New password must be different from your current password.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setValidationError("New password and confirm password do not match.");
      return;
    }

    setValidationError(null);
    mutation.mutate();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-w-lg">
      <PasswordField
        id="current-password"
        label="Current Password"
        value={currentPassword}
        onChange={(v) => { setCurrentPassword(v); setValidationError(null); setSuccessMessage(null); }}
        autoComplete="current-password"
        disabled={mutation.isPending}
      />
      <div>
        <PasswordField
          id="new-password"
          label="New Password"
          value={newPassword}
          onChange={(v) => { setNewPassword(v); setValidationError(null); setSuccessMessage(null); }}
          autoComplete="new-password"
          disabled={mutation.isPending}
        />
        <PasswordStrengthMeter password={newPassword} />
      </div>
      <PasswordField
        id="confirm-password"
        label="Confirm New Password"
        value={confirmPassword}
        onChange={(v) => { setConfirmPassword(v); setValidationError(null); setSuccessMessage(null); }}
        autoComplete="new-password"
        disabled={mutation.isPending}
      />

      {validationError && (
        <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {validationError}
        </p>
      )}
      {successMessage && (
        <p className="rounded-md border border-green-500/40 bg-green-500/5 px-3 py-2 text-sm text-green-600 dark:text-green-400">
          {successMessage}
        </p>
      )}

      <Button type="submit" disabled={mutation.isPending}>
        {mutation.isPending ? "Changing…" : "Change Password"}
      </Button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Send reset link section
// ---------------------------------------------------------------------------

function SendResetLinkSection({ email }: { email: string | null }) {
  const [status, setStatus] = useState<"idle" | "sent" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => {
      if (!email) throw new Error("No email address on your account.");
      return authApi.forgotPassword({
        email,
        redirectTo: `${window.location.origin}/auth/reset-password`,
      });
    },
    onSuccess: () => {
      setStatus("sent");
      setErrorMessage(null);
    },
    onError: (err) => {
      setStatus("error");
      setErrorMessage(err instanceof Error ? err.message : "Failed to send reset link.");
    },
  });

  return (
    <section className="rounded-xl border border-border bg-card p-5 space-y-4">
      <div className="space-y-1">
        <h3 className="text-sm font-semibold">Reset Password via Email</h3>
        <p className="text-sm text-muted-foreground">
          Don&rsquo;t remember your current password? We&rsquo;ll send a reset link to your email address so you can set a new one.
        </p>
      </div>

      <div className="border-t border-border pt-4 space-y-3">
        {email ? (
          <div className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm text-foreground/70 max-w-lg">
            <Mail className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate">{email}</span>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground italic">No email address associated with your account.</p>
        )}

        {status === "sent" ? (
          <p className="rounded-md border border-green-500/40 bg-green-500/5 px-3 py-2 text-sm text-green-600 dark:text-green-400">
            Reset link sent! Check your inbox at <strong>{email}</strong>.
          </p>
        ) : (
          <>
            {status === "error" && errorMessage && (
              <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {errorMessage}
              </p>
            )}
            <Button
              variant="outline"
              disabled={mutation.isPending || !email}
              onClick={() => { setStatus("idle"); mutation.mutate(); }}
            >
              <Mail className="h-4 w-4 mr-2" />
              {mutation.isPending ? "Sending…" : "Send Reset Link"}
            </Button>
          </>
        )}
      </div>
    </section>
  );
}

function PasskeySection() {
  const [status, setStatus] = useState<"idle" | "success" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => authApi.addPasskey(),
    onSuccess: () => {
      setStatus("success");
      setMessage("Passkey added successfully. You can now use passkey sign-in on the login page.");
    },
    onError: (err) => {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "Failed to register passkey.");
    },
  });

  return (
    <section className="rounded-xl border border-border bg-card p-5 space-y-4">
      <div className="space-y-1">
        <h3 className="text-sm font-semibold">Passkey Sign-In</h3>
        <p className="text-sm text-muted-foreground">
          Register a device passkey (Face ID, fingerprint, or security key) for faster and safer sign-in.
        </p>
      </div>

      <div className="border-t border-border pt-4 space-y-3">
        <Button
          type="button"
          variant="outline"
          disabled={mutation.isPending}
          onClick={() => {
            setStatus("idle");
            setMessage(null);
            mutation.mutate();
          }}
        >
          {mutation.isPending ? "Registering passkey..." : "Add Passkey"}
        </Button>

        {status === "success" && message && (
          <p className="rounded-md border border-green-500/40 bg-green-500/5 px-3 py-2 text-sm text-green-600 dark:text-green-400">
            {message}
          </p>
        )}
        {status === "error" && message && (
          <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {message}
          </p>
        )}
      </div>
    </section>
  );
}

function AccountDetailsTab({ email }: { email: string | null }) {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <KeyRound className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-lg font-semibold">Account Details</h2>
        </div>
        <p className="text-sm text-muted-foreground">Manage your account security settings.</p>
      </div>

      <section className="rounded-xl border border-border bg-card p-5 space-y-4">
        <div className="space-y-1">
          <h3 className="text-sm font-semibold">Change Password</h3>
          <p className="text-sm text-muted-foreground">
            Update your password. You will need to enter your current password to confirm the change.
          </p>
        </div>
        <div className="border-t border-border pt-4">
          <ChangePasswordForm />
        </div>
      </section>

      <PasskeySection />

      <SendResetLinkSection email={email} />
    </div>
  );
}

function NotificationPreferencesTab() {
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ["user-notification-preferences"],
    queryFn: () => authApi.getNotificationPreferences(),
    staleTime: 30_000,
  });

  const mutation = useMutation({
    mutationFn: (patch: Parameters<typeof authApi.updateNotificationPreferences>[0]) =>
      authApi.updateNotificationPreferences(patch),
    onSuccess: () => {
      setSavedMessage("Notification preferences saved.");
      setErrorMessage(null);
    },
    onError: (err) => {
      setErrorMessage(err instanceof Error ? err.message : "Failed to save preferences.");
      setSavedMessage(null);
    },
  });

  const pref = data;
  const notificationEvents: Array<{
    key: "issue.status_changed" | "issue.comment_added" | "issue.comment_mentioned" | "issue.assigned";
    label: string;
    description: string;
  }> = [
    {
      key: "issue.status_changed",
      label: "Issue status changes",
      description: "Notify me when an issue moves between states (for example, In Review or Done).",
    },
    {
      key: "issue.comment_added",
      label: "New comments",
      description: "Notify me when someone adds a new comment to an issue I am involved in.",
    },
    {
      key: "issue.comment_mentioned",
      label: "@mentions in comments",
      description: "Notify me when someone @mentions me in an issue comment.",
    },
    {
      key: "issue.assigned",
      label: "Issue assignments",
      description: "Notify me when an issue is assigned to me.",
    },
  ];

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Bell className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-lg font-semibold">Notifications</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Configure how you receive task notifications.
        </p>
      </div>

      <section className="rounded-xl border border-border bg-card p-5 space-y-4 max-w-xl">
        {isLoading || !pref ? (
          <p className="text-sm text-muted-foreground">Loading preferences…</p>
        ) : (
          <>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={pref.enabled}
                onChange={(e) => {
                  setSavedMessage(null);
                  setErrorMessage(null);
                  mutation.mutate({ enabled: e.target.checked });
                }}
                disabled={mutation.isPending}
              />
              Enable notifications
            </label>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={pref.channels.email.enabled}
                onChange={(e) => {
                  setSavedMessage(null);
                  setErrorMessage(null);
                  mutation.mutate({
                    channels: {
                      ...pref.channels,
                      email: { ...pref.channels.email, enabled: e.target.checked },
                    },
                  });
                }}
                disabled={mutation.isPending}
              />
              Email notifications
            </label>

            <div className="space-y-2 border-t border-border pt-3">
              <p className="text-sm font-medium">Event preferences</p>
              {notificationEvents.map((eventType) => (
                <label key={eventType.key} className="block rounded-md border border-border/70 px-2.5 py-2">
                  <div className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={pref.events[eventType.key]?.enabled ?? true}
                      onChange={(e) => {
                        setSavedMessage(null);
                        setErrorMessage(null);
                        mutation.mutate({
                          events: {
                            ...pref.events,
                            [eventType.key]: {
                              ...(pref.events[eventType.key] ?? {}),
                              enabled: e.target.checked,
                            },
                          },
                        });
                      }}
                      disabled={mutation.isPending}
                    />
                    <span className="min-w-0">
                      <span className="block font-medium">{eventType.label}</span>
                      <span className="block text-xs text-muted-foreground">{eventType.description}</span>
                    </span>
                  </div>
                </label>
              ))}
            </div>
          </>
        )}

        {errorMessage && (
          <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {errorMessage}
          </p>
        )}
        {savedMessage && (
          <p className="rounded-md border border-green-500/40 bg-green-500/5 px-3 py-2 text-sm text-green-600 dark:text-green-400">
            {savedMessage}
          </p>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

const TABS = [
  { value: "personal", label: "Personal Details" },
  { value: "account", label: "Account Details" },
  { value: "notifications", label: "Notifications" },
];

export function AccountSettings() {
  const { setBreadcrumbs } = useBreadcrumbs();
  const navigate = useNavigate();
  const [tab, setTab] = useState("personal");

  useEffect(() => {
    setBreadcrumbs([{ label: "Account Settings" }]);
  }, [setBreadcrumbs]);

  const { data: session } = useQuery({
    queryKey: queryKeys.auth.session,
    queryFn: () => authApi.getSession(),
    staleTime: 60_000,
  });

  return (
    <div className="max-w-4xl space-y-6">
      {/* Header with close button */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Account Settings</h1>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => navigate(-1)}
          aria-label="Close account settings"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <PageTabBar items={TABS} value={tab} onValueChange={setTab} align="start" />

        <TabsContent value="personal" className="mt-6">
          <PersonalDetailsTab
            name={session?.user.name ?? null}
            email={session?.user.email ?? null}
          />
        </TabsContent>

        <TabsContent value="account" className="mt-6">
          <AccountDetailsTab email={session?.user.email ?? null} />
        </TabsContent>
        <TabsContent value="notifications" className="mt-6">
          <NotificationPreferencesTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
