import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@/lib/router";
import { Button } from "@/components/ui/button";
import { Sparkles, Eye, EyeOff } from "lucide-react";
import { queryKeys } from "../lib/queryKeys";
import { cn } from "../lib/utils";

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

async function completePasswordSetup(newPassword: string): Promise<void> {
  const res = await fetch("/api/auth/complete-password-setup", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ newPassword }),
  });
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    const p = payload as Record<string, unknown> | null;
    const message =
      (typeof p?.message === "string" ? p.message : null) ?? `Request failed: ${res.status}`;
    throw new Error(message);
  }
}

export function ForceChangePasswordPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const strength = evaluatePasswordStrength(password);

  const mutation = useMutation({
    mutationFn: () => completePasswordSetup(password),
    onSuccess: async () => {
      // Refresh session so mustChangePassword is cleared in the UI
      await queryClient.invalidateQueries({ queryKey: queryKeys.auth.session });
      navigate("/", { replace: true });
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : "Failed to update password. Please try again.");
    },
  });

  const canSubmit = strength.score >= 3 && password === confirmPassword;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (mutation.isPending) return;
    if (strength.score < 3) {
      setError("Password is too weak. Please meet at least 3 of the 5 requirements.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    setError(null);
    mutation.mutate();
  }

  return (
    <div className="fixed inset-0 flex bg-background">
      {/* Left half — form */}
      <div className="w-full md:w-1/2 flex flex-col overflow-y-auto">
        <div className="w-full max-w-md mx-auto my-auto px-8 py-12">
          <div className="flex items-center gap-2 mb-8">
            <Sparkles className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">AI-Harness</span>
          </div>

          <h1 className="text-xl font-semibold">Set your password</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Welcome! Before you continue, you must set a personal password for your account.
            Your temporary password will no longer work after this step.
          </p>

          <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
            <div>
              <label htmlFor="new-password" className="text-xs text-muted-foreground mb-1 block">
                New password
              </label>
              <div className="relative">
                <input
                  id="new-password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  autoFocus
                  className="w-full rounded-md border border-border bg-transparent px-3 py-2 pr-10 text-sm outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50"
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setError(null); }}
                  placeholder="Minimum 8 characters"
                />
                <button
                  type="button"
                  tabIndex={-1}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <PasswordStrengthMeter password={password} />
            </div>

            <div>
              <label htmlFor="confirm-password" className="text-xs text-muted-foreground mb-1 block">
                Confirm new password
              </label>
              <div className="relative">
                <input
                  id="confirm-password"
                  type={showConfirmPassword ? "text" : "password"}
                  autoComplete="new-password"
                  className="w-full rounded-md border border-border bg-transparent px-3 py-2 pr-10 text-sm outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50"
                  value={confirmPassword}
                  onChange={(e) => { setConfirmPassword(e.target.value); setError(null); }}
                  placeholder="Re-enter your new password"
                />
                <button
                  type="button"
                  tabIndex={-1}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => setShowConfirmPassword((v) => !v)}
                  aria-label={showConfirmPassword ? "Hide password" : "Show password"}
                >
                  {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {confirmPassword.length > 0 && password !== confirmPassword && (
              <p className="text-xs text-amber-600 dark:text-amber-400">Passwords do not match.</p>
            )}

            {error && <p className="text-xs text-destructive">{error}</p>}

            <Button
              type="submit"
              disabled={mutation.isPending}
              className={`w-full ${!canSubmit && !mutation.isPending ? "opacity-50" : ""}`}
            >
              {mutation.isPending ? "Setting password…" : "Set Password & Continue"}
            </Button>
          </form>
        </div>
      </div>

      {/* Right half — decorative */}
      <div className="hidden md:flex w-1/2 items-center justify-center bg-muted/20">
        <div className="text-center space-y-3 px-8 max-w-xs">
          <Sparkles className="h-8 w-8 text-muted-foreground mx-auto" />
          <p className="text-sm font-medium">First time here?</p>
          <p className="text-xs text-muted-foreground">
            Your account was set up with a temporary password. Please create a permanent one to secure your access.
          </p>
        </div>
      </div>
    </div>
  );
}
