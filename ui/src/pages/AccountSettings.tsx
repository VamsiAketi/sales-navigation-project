import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Eye, EyeOff, KeyRound, User, X } from "lucide-react";
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
// Personal Details tab
// ---------------------------------------------------------------------------

function PersonalDetailsTab({ name, email }: { name: string | null; email: string | null }) {
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
        <ReadOnlyField id="pd-name" label="Name" value={name ?? "—"} />
        <ReadOnlyField id="pd-email" label="Email" value={email ?? "—"} />
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

function AccountDetailsTab() {
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
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

const TABS = [
  { value: "personal", label: "Personal Details" },
  { value: "account", label: "Account Details" },
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
          <AccountDetailsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
