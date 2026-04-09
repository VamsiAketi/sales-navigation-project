import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "@/lib/router";
import { authApi } from "../api/auth";
import { healthApi } from "../api/health";
import { queryKeys } from "../lib/queryKeys";
import { Button } from "@/components/ui/button";
import { Sparkles, Eye, EyeOff } from "lucide-react";
import { buildVisibleVersionLabel } from "@/components/Layout";

type AuthMode = "sign_in" | "sign_up";
type SignInMethod = "password" | "email_code";

export function AuthPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [mode, setMode] = useState<AuthMode>("sign_in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [signInMethod, setSignInMethod] = useState<SignInMethod>("password");
  const [emailCode, setEmailCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [codeSuccess, setCodeSuccess] = useState<string | null>(null);
  const [forgotRequested, setForgotRequested] = useState(false);
  const [forgotSuccess, setForgotSuccess] = useState<string | null>(null);
  const [resetSuccess, setResetSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const nextPath = useMemo(() => searchParams.get("next") || "/", [searchParams]);
  const loggedOut = useMemo(() => searchParams.get("logged_out") === "1", [searchParams]);
  const resetToken = useMemo(
    () => searchParams.get("token") || searchParams.get("resetToken") || "",
    [searchParams],
  );
  const isResetMode = resetToken.length > 0;
  const { data: session, isLoading: isSessionLoading } = useQuery({
    queryKey: queryKeys.auth.session,
    queryFn: () => authApi.getSession(),
    retry: false,
  });

  const { data: health } = useQuery({
    queryKey: queryKeys.health,
    queryFn: () => healthApi.get(),
    retry: false,
  });

  useEffect(() => {
    if (session && !loggedOut) {
      navigate(nextPath, { replace: true });
    }
  }, [session, loggedOut, navigate, nextPath]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (mode === "sign_in") {
        if (signInMethod === "email_code") {
          await authApi.signInEmailCode({ email: email.trim(), code: emailCode.trim() });
          return;
        }
        await authApi.signInEmail({ email: email.trim(), password });
        return;
      }
      // Sign-up disabled: users cannot create their own accounts
      // await authApi.signUpEmail({
      //   name: name.trim(),
      //   email: email.trim(),
      //   password,
      // });
    },
    onSuccess: async () => {
      setError(null);
      await queryClient.invalidateQueries({ queryKey: queryKeys.auth.session });
      await queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
      navigate(nextPath, { replace: true });
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : "Authentication failed");
    },
  });

  const sendCodeMutation = useMutation({
    mutationFn: async () => {
      await authApi.sendEmailSignInCode({ email: email.trim() });
    },
    onSuccess: () => {
      setError(null);
      setCodeSent(true);
      setCodeSuccess("Code sent. Check your email and enter the code to continue.");
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : "Failed to send sign-in code");
    },
  });

  const forgotPasswordMutation = useMutation({
    mutationFn: async () => {
      const redirectTo = typeof window !== "undefined"
        ? `${window.location.origin}/auth`
        : "/auth";
      await authApi.forgotPassword({ email: email.trim(), redirectTo });
    },
    onSuccess: () => {
      setError(null);
      setForgotSuccess("If an account exists for that email, a reset link has been sent.");
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : "Failed to request password reset");
    },
  });

  const resetPasswordMutation = useMutation({
    mutationFn: async () => {
      await authApi.resetPassword({ token: resetToken, newPassword: password });
    },
    onSuccess: () => {
      setError(null);
      setResetSuccess("Password updated. You can now sign in with your new password.");
      setPassword("");
      setConfirmPassword("");
      setTimeout(() => navigate("/auth", { replace: true }), 2500);
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : "Failed to reset password");
    },
  });

  const canSubmit =
    email.trim().length > 0 &&
    (signInMethod === "email_code" ? emailCode.trim().length > 0 : password.trim().length > 0) &&
    (mode === "sign_in" || (name.trim().length > 0 && password.trim().length >= 8));
  const canRequestReset = email.trim().length > 0;
  const canSubmitReset = password.trim().length >= 8 && confirmPassword === password;

  const versionLabel = buildVisibleVersionLabel(health?.version);

  if (isSessionLoading) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center bg-background">
      <div className="w-full max-w-md px-8 py-12">
          <div className="flex items-center gap-2 mb-8">
            <Sparkles className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">AI-Harness</span>
          </div>

          <h1 className="text-xl font-semibold">
            {isResetMode
              ? "Reset your password"
              : mode === "sign_in"
                ? "Sign in to AI-Harness"
                : "Create your AI-Harness account"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {isResetMode
              ? "Set a new password for your account."
              : mode === "sign_in"
                ? "Use your email and password to access this instance."
                : "Create an account for this instance. Email confirmation is not required in v1."}
          </p>
          {loggedOut && (
            <p className="mt-2 text-xs text-muted-foreground">
              You were signed out. Sign in again to continue.
            </p>
          )}

          <form
            className="mt-6 space-y-4"
            method="post"
            action={mode === "sign_up" ? "/api/auth/sign-up/email" : "/api/auth/sign-in/email"}
            onSubmit={(event) => {
              event.preventDefault();
              if (isResetMode) {
                if (resetPasswordMutation.isPending) return;
                if (!canSubmitReset) {
                  setError("Use a password with at least 8 characters and confirm it.");
                  return;
                }
                resetPasswordMutation.mutate();
                return;
              }
              if (mutation.isPending) return;
              if (!canSubmit) {
                setError(
                  signInMethod === "email_code"
                    ? "Enter your email and verification code."
                    : "Please fill in all required fields.",
                );
                return;
              }
              mutation.mutate();
            }}
          >
            {/* Sign-up disabled: name field hidden
            {mode === "sign_up" && (
              <div>
                <label htmlFor="name" className="text-xs text-muted-foreground mb-1 block">Name</label>
                <input
                  id="name"
                  name="name"
                  className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  autoComplete="name"
                  autoFocus
                />
              </div>
            )}
            */}
            {!isResetMode && (
              <div>
                <label htmlFor="email" className="text-xs text-muted-foreground mb-1 block">Email</label>
                <input
                  id="email"
                  name="email"
                  className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50"
                  type="email"
                  value={email}
                  onChange={(event) => {
                    setEmail(event.target.value);
                    setError(null);
                    setForgotSuccess(null);
                  }}
                  autoComplete="email"
                  autoFocus={mode === "sign_in"}
                />
              </div>
            )}
            {!isResetMode && mode === "sign_in" && (
              <div className="rounded-md border border-border bg-muted/20 p-1 text-xs">
                <div className="grid grid-cols-2 gap-1">
                  <button
                    type="button"
                    className={`rounded-sm px-2 py-1 text-left ${
                      signInMethod === "password" ? "bg-background text-foreground" : "text-muted-foreground hover:text-foreground"
                    }`}
                    onClick={() => {
                      setSignInMethod("password");
                      setError(null);
                    }}
                  >
                    Password
                  </button>
                  <button
                    type="button"
                    className={`rounded-sm px-2 py-1 text-left ${
                      signInMethod === "email_code" ? "bg-background text-foreground" : "text-muted-foreground hover:text-foreground"
                    }`}
                    onClick={() => {
                      setSignInMethod("email_code");
                      setError(null);
                    }}
                  >
                    Email code
                  </button>
                </div>
              </div>
            )}
            {(isResetMode || signInMethod === "password") && (
              <div>
                <label htmlFor="password" className="text-xs text-muted-foreground mb-1 block">Password</label>
                {!(!isResetMode && mode === "sign_in" && forgotRequested) && (
                  <div className="relative">
                    <input
                      id="password"
                      name="password"
                      className="w-full rounded-md border border-border bg-transparent px-3 py-2 pr-10 text-sm outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50"
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      autoComplete={mode === "sign_in" ? "current-password" : "new-password"}
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
                )}
              </div>
            )}
            {!isResetMode && mode === "sign_in" && signInMethod === "email_code" && (
              <div className="space-y-2">
                <div>
                  <label htmlFor="email-code" className="text-xs text-muted-foreground mb-1 block">Verification code</label>
                  <input
                    id="email-code"
                    className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50"
                    type="text"
                    inputMode="numeric"
                    value={emailCode}
                    onChange={(event) => setEmailCode(event.target.value)}
                    placeholder="Enter code"
                    autoComplete="one-time-code"
                  />
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={email.trim().length === 0 || sendCodeMutation.isPending}
                  onClick={() => {
                    if (email.trim().length === 0) {
                      setError("Enter your email first.");
                      return;
                    }
                    setCodeSuccess(null);
                    setError(null);
                    sendCodeMutation.mutate();
                  }}
                  className="w-full"
                >
                  {sendCodeMutation.isPending ? "Sending code…" : codeSent ? "Resend code" : "Send code"}
                </Button>
              </div>
            )}
            {isResetMode && (
              <div>
                <label htmlFor="confirm-password" className="text-xs text-muted-foreground mb-1 block">Confirm password</label>
                <div className="relative">
                  <input
                    id="confirm-password"
                    className="w-full rounded-md border border-border bg-transparent px-3 py-2 pr-10 text-sm outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50"
                    type={showConfirmPassword ? "text" : "password"}
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    autoComplete="new-password"
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
            )}
            {!isResetMode && mode === "sign_in" && (
              <div className="flex items-center justify-between gap-2 text-xs">
                <button
                  type="button"
                  className="text-muted-foreground underline underline-offset-2 hover:text-foreground"
                  onClick={() => {
                    setForgotRequested((prev) => !prev);
                    setError(null);
                    setForgotSuccess(null);
                    setPassword("");
                  }}
                >
                  {forgotRequested ? "Back to sign in" : "Forgot password?"}
                </button>
              </div>
            )}
            {!isResetMode && mode === "sign_in" && forgotRequested && (
              <div className="rounded-md border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground space-y-2">
                <p>Enter your email and we will send a password reset link.</p>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={!canRequestReset || forgotPasswordMutation.isPending}
                  onClick={() => {
                    if (!canRequestReset) {
                      setError("Enter your email first.");
                      return;
                    }
                    forgotPasswordMutation.mutate();
                  }}
                  className="w-full"
                >
                  {forgotPasswordMutation.isPending ? "Sending reset link…" : "Send reset link"}
                </Button>
              </div>
            )}
            {error && <p className="text-xs text-destructive">{error}</p>}
            {codeSuccess && <p className="text-xs text-emerald-600 dark:text-emerald-400">{codeSuccess}</p>}
            {forgotSuccess && <p className="text-xs text-emerald-600 dark:text-emerald-400">{forgotSuccess}</p>}
            {resetSuccess && <p className="text-xs text-emerald-600 dark:text-emerald-400">{resetSuccess}</p>}
            {!(!isResetMode && mode === "sign_in" && forgotRequested) && (
              <Button
                type="submit"
                disabled={isResetMode ? resetPasswordMutation.isPending : mutation.isPending}
                aria-disabled={
                  isResetMode
                    ? !canSubmitReset || resetPasswordMutation.isPending
                    : !canSubmit || mutation.isPending
                }
                className={`w-full ${
                  isResetMode
                    ? !canSubmitReset && !resetPasswordMutation.isPending ? "opacity-50" : ""
                    : !canSubmit && !mutation.isPending ? "opacity-50" : ""
                }`}
              >
                {isResetMode
                  ? resetPasswordMutation.isPending
                    ? "Resetting…"
                    : "Reset Password"
                  : mutation.isPending
                    ? "Working…"
                    : mode === "sign_in"
                      ? "Sign In"
                      : "Create Account"}
              </Button>
            )}
          </form>

          {/* Sign-up disabled: account creation link hidden
          <div className="mt-5 text-sm text-muted-foreground">
            {mode === "sign_in" ? "Need an account?" : "Already have an account?"}{" "}
            <button
              type="button"
              className="font-medium text-foreground underline underline-offset-2"
              onClick={() => {
                setError(null);
                setMode(mode === "sign_in" ? "sign_up" : "sign_in");
              }}
            >
              {mode === "sign_in" ? "Create one" : "Sign in"}
            </button>
          </div>
          */}
      </div>
      {versionLabel && (
        <span className="text-xs text-muted-foreground" title={versionLabel}>
          Version: {versionLabel}
        </span>
      )}
    </div>
  );
}
