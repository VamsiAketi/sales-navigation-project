import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "@/lib/router";
import { authApi } from "../api/auth";
import { healthApi } from "../api/health";
import { queryKeys } from "../lib/queryKeys";
import { Button } from "@/components/ui/button";
import { Eye, EyeOff, KeyRound, Mail, Lock } from "lucide-react";
import { buildVisibleVersionLabel } from "@/components/Layout";
import {
  instanceSubdomainFromBrowserHost,
  isLoopbackHostname,
} from "../lib/instance-subdomain";

type AuthMode = "sign_in" | "sign_up";
const OTP_LENGTH = 6;

function MicrosoftLogo({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <span className={`inline-grid grid-cols-2 grid-rows-2 gap-[1px] ${className}`} aria-hidden>
      <span className="bg-[#f35325]" />
      <span className="bg-[#81bc06]" />
      <span className="bg-[#05a6f0]" />
      <span className="bg-[#ffba08]" />
    </span>
  );
}

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
  const [showPasswordLogin, setShowPasswordLogin] = useState(false);
  const [signInFlowStarted, setSignInFlowStarted] = useState(false);
  const [canUseOtpAndPasskey, setCanUseOtpAndPasskey] = useState(false);
  const [useEmailCode, setUseEmailCode] = useState(false);
  const [emailCode, setEmailCode] = useState("");
  const [otpDigits, setOtpDigits] = useState<string[]>(Array.from({ length: OTP_LENGTH }, () => ""));
  const otpRefs = useRef<Array<HTMLInputElement | null>>([]);
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
        if (useEmailCode) {
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
      setCodeSuccess("If an account exists for that email, an OTP has been sent.");
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : "Failed to send sign-in code");
    },
  });

  const continueSignInMutation = useMutation({
    mutationFn: async () => {
      return authApi.getSignInMethod({ email: email.trim() });
    },
    onSuccess: ({ mode }) => {
      setError(null);
      setForgotSuccess(null);
      setSignInFlowStarted(true);
      if (mode === "password_only") {
        setCanUseOtpAndPasskey(false);
        setUseEmailCode(false);
        setShowPasswordLogin(true);
        return;
      }
      setCanUseOtpAndPasskey(true);
      setShowPasswordLogin(false);
      setUseEmailCode(true);
      // Move directly to OTP input screen while code is being sent.
      setCodeSent(true);
      setOtpDigits(Array.from({ length: OTP_LENGTH }, () => ""));
      setEmailCode("");
      setCodeSuccess(null);
      sendCodeMutation.mutate();
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : "Failed to continue sign in");
    },
  });

  const passkeyMutation = useMutation({
    mutationFn: async () => {
      await authApi.signInPasskey();
    },
    onSuccess: async () => {
      setError(null);
      await queryClient.invalidateQueries({ queryKey: queryKeys.auth.session });
      await queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
      navigate(nextPath, { replace: true });
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : "Passkey sign-in failed");
    },
  });

  const microsoftMutation = useMutation({
    mutationFn: async () => {
      await authApi.signInMicrosoft();
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : "Microsoft sign-in failed");
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
      setForgotSuccess("Reset link sent to your email.");
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
    (useEmailCode
      ? codeSent && emailCode.trim().length === OTP_LENGTH
      : mode === "sign_in"
        ? signInFlowStarted && showPasswordLogin && password.trim().length > 0
        : password.trim().length > 0) &&
    (mode === "sign_in" || (name.trim().length > 0 && password.trim().length >= 8));
  const canRequestReset = email.trim().length > 0;
  const canSubmitReset = password.trim().length >= 8 && confirmPassword === password;

  const versionLabel = buildVisibleVersionLabel(health?.version);

  /** Tenant subdomain, or in Vite dev on loopback a fixed "Local" label for UI testing. */
  const instanceDisplayLabel = useMemo(() => {
    if (typeof window === "undefined") return null;
    const sub = instanceSubdomainFromBrowserHost(window.location.host);
    if (sub) return sub;
    if (import.meta.env.DEV && isLoopbackHostname(window.location.hostname)) {
      return "Local";
    }
    return null;
  }, []);

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
          {instanceDisplayLabel ? (
            <div className="mb-2 w-full">
              <p
                className="text-xl font-semibold text-foreground break-words"
                title={
                  import.meta.env.DEV &&
                  instanceDisplayLabel === "Local" &&
                  isLoopbackHostname(window.location.hostname)
                    ? "Dev-only placeholder on localhost (not a real subdomain)"
                    : `Instance: ${instanceDisplayLabel}`
                }
              >
                {instanceDisplayLabel}
              </p>
            </div>
          ) : null}

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
                ? useEmailCode
                  ? codeSent
                    ? "Enter the verification code sent to your email to sign in."
                    : "Sending a one-time verification code to your email."
                  : signInFlowStarted
                    ? "Enter your password to continue."
                    : "Enter your email to continue."
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
              if (mode === "sign_in" && !signInFlowStarted) {
                if (continueSignInMutation.isPending) return;
                if (email.trim().length === 0) {
                  setError("Enter your email first.");
                  return;
                }
                continueSignInMutation.mutate();
                return;
              }
              if (mutation.isPending) return;
              if (!canSubmit) {
                setError(
                  useEmailCode
                    ? "Enter your verification code to continue."
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
                    setSignInFlowStarted(false);
                    setCanUseOtpAndPasskey(false);
                    setUseEmailCode(false);
                    setShowPasswordLogin(false);
                    setForgotRequested(false);
                    setPassword("");
                    setCodeSent(false);
                    setCodeSuccess(null);
                    setOtpDigits(Array.from({ length: OTP_LENGTH }, () => ""));
                    setEmailCode("");
                  }}
                  autoComplete="email"
                  autoFocus={mode === "sign_in"}
                />
              </div>
            )}
            {(isResetMode || (!useEmailCode && (mode !== "sign_in" || showPasswordLogin))) && (
              <div>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <label htmlFor="password" className="text-xs text-muted-foreground block">Password</label>
                  {!isResetMode && mode === "sign_in" && !useEmailCode && (
                    <button
                      type="button"
                      className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                      onClick={() => {
                        setForgotRequested((prev) => !prev);
                        setError(null);
                        setForgotSuccess(null);
                        setPassword("");
                      }}
                    >
                      {forgotRequested ? "Back to sign in" : "Forgot password?"}
                    </button>
                  )}
                </div>
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
            {!isResetMode && mode === "sign_in" && signInFlowStarted && canUseOtpAndPasskey && useEmailCode && (
              <div className="space-y-3 rounded-xl border border-border bg-card/70 p-4">
                <div>
                  <label className="mb-2 block text-xs text-muted-foreground">Verification code</label>
                  {sendCodeMutation.isPending && (
                    <p className="mb-2 text-xs text-muted-foreground">Sending OTP to your email...</p>
                  )}
                  <div className="grid grid-cols-6 gap-2">
                    {otpDigits.map((digit, index) => (
                      <input
                        key={`otp-${index}`}
                        ref={(el) => {
                          otpRefs.current[index] = el;
                        }}
                        className="h-10 rounded-md border border-border bg-background text-center text-sm font-semibold outline-none transition focus:border-primary focus:ring-1 focus:ring-primary/30"
                        type="text"
                        inputMode="numeric"
                        maxLength={1}
                        value={digit}
                        autoComplete={index === 0 ? "one-time-code" : "off"}
                        onChange={(event) => {
                          const raw = event.target.value;
                          const nextChar = raw.replace(/\D/g, "").slice(-1);
                          const next = [...otpDigits];
                          next[index] = nextChar;
                          setOtpDigits(next);
                          const joined = next.join("");
                          setEmailCode(joined);
                          if (nextChar && index < OTP_LENGTH - 1) {
                            otpRefs.current[index + 1]?.focus();
                          }
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Backspace" && !otpDigits[index] && index > 0) {
                            otpRefs.current[index - 1]?.focus();
                          }
                        }}
                        onPaste={(event) => {
                          event.preventDefault();
                          const pasted = event.clipboardData.getData("text").replace(/\D/g, "").slice(0, OTP_LENGTH);
                          if (!pasted) return;
                          const next = Array.from({ length: OTP_LENGTH }, (_, i) => pasted[i] ?? "");
                          setOtpDigits(next);
                          setEmailCode(next.join(""));
                          const focusIndex = Math.min(pasted.length, OTP_LENGTH - 1);
                          otpRefs.current[focusIndex]?.focus();
                        }}
                      />
                    ))}
                  </div>
                </div>
                <Button
                  type="submit"
                  disabled={!canSubmit || mutation.isPending}
                  className="w-full"
                >
                  {mutation.isPending ? "Verifying..." : "Verify & Login"}
                </Button>
                <button
                  type="button"
                  className="w-full text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                  onClick={() => {
                    setCodeSent(false);
                    setOtpDigits(Array.from({ length: OTP_LENGTH }, () => ""));
                    setEmailCode("");
                    setCodeSuccess(null);
                    setError(null);
                  }}
                >
                  Change email
                </button>
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
            {!isResetMode && mode === "sign_in" && showPasswordLogin && forgotRequested && (
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
            {error && <p className="text-center text-xs text-destructive">{error}</p>}
            {codeSuccess && <p className="text-center text-xs text-emerald-600 dark:text-emerald-400">{codeSuccess}</p>}
            {forgotSuccess && <p className="text-center text-xs text-emerald-600 dark:text-emerald-400">{forgotSuccess}</p>}
            {resetSuccess && <p className="text-center text-xs text-emerald-600 dark:text-emerald-400">{resetSuccess}</p>}
            {!(!isResetMode && mode === "sign_in" && forgotRequested) && !(useEmailCode && !codeSent) && (
              <>
                {!isResetMode && mode === "sign_in" && useEmailCode && codeSent ? (
                  <>
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={email.trim().length === 0 || sendCodeMutation.isPending}
                      onClick={() => {
                        if (email.trim().length === 0) {
                          setError("Enter your email first.");
                          return;
                        }
                        const next = Array.from({ length: OTP_LENGTH }, () => "");
                        setOtpDigits(next);
                        setEmailCode("");
                        setCodeSuccess(null);
                        setError(null);
                        sendCodeMutation.mutate();
                      }}
                      className="w-full"
                    >
                      {sendCodeMutation.isPending ? "Sending OTP..." : "Resend OTP"}
                    </Button>
                    <div className="flex items-center gap-3">
                      <div className="h-px flex-1 bg-border" />
                      <span className="text-xs text-muted-foreground">or</span>
                      <div className="h-px flex-1 bg-border" />
                    </div>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => {
                        setShowPasswordLogin(true);
                        setUseEmailCode(false);
                        setOtpDigits(Array.from({ length: OTP_LENGTH }, () => ""));
                        setEmailCode("");
                        setCodeSuccess(null);
                        setError(null);
                      }}
                      className="w-full"
                    >
                      <Lock className="mr-2 h-4 w-4 text-amber-500 dark:text-amber-400" />
                      Login using Password
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={passkeyMutation.isPending}
                      onClick={() => {
                        setError(null);
                        passkeyMutation.mutate();
                      }}
                      className="w-full"
                    >
                      <KeyRound className="mr-2 h-4 w-4 text-blue-600 dark:text-blue-400" />
                      {passkeyMutation.isPending ? "Opening Passkey..." : "Login with Passkey"}
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={microsoftMutation.isPending || passkeyMutation.isPending}
                      onClick={() => {
                        setError(null);
                        microsoftMutation.mutate();
                      }}
                      className="w-full"
                    >
                      <MicrosoftLogo className="mr-2 h-4 w-4" />
                      {microsoftMutation.isPending ? "Opening Microsoft..." : "Login with Microsoft"}
                    </Button>
                  </>
                ) : (
                  <>
                    {!isResetMode && mode === "sign_in" && !signInFlowStarted && (
                      <>
                        <Button
                          type="submit"
                          disabled={email.trim().length === 0 || continueSignInMutation.isPending}
                          className={`w-full ${
                            email.trim().length === 0 && !continueSignInMutation.isPending ? "opacity-50" : ""
                          }`}
                        >
                          {continueSignInMutation.isPending ? "Checking..." : "Continue"}
                        </Button>
                        <div className="pt-1">
                          <div className="mb-3 flex items-center gap-3">
                            <div className="h-px flex-1 bg-border" />
                            <span className="text-xs text-muted-foreground">Or continue with</span>
                            <div className="h-px flex-1 bg-border" />
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <Button
                              type="button"
                              variant="secondary"
                              disabled={passkeyMutation.isPending || microsoftMutation.isPending}
                              onClick={() => {
                                setError(null);
                                passkeyMutation.mutate();
                              }}
                              className="h-11 rounded-full"
                            >
                              <KeyRound className="mr-2 h-4 w-4 text-blue-600 dark:text-blue-400" />
                              {passkeyMutation.isPending ? "Opening..." : "Passkey"}
                            </Button>
                            <Button
                              type="button"
                              variant="secondary"
                              disabled={microsoftMutation.isPending || passkeyMutation.isPending}
                              onClick={() => {
                                setError(null);
                                microsoftMutation.mutate();
                              }}
                              className="h-11 rounded-full"
                            >
                              <MicrosoftLogo className="mr-2 h-4 w-4" />
                              {microsoftMutation.isPending ? "Opening..." : "Microsoft"}
                            </Button>
                          </div>
                        </div>
                      </>
                    )}
                    {(isResetMode || mode !== "sign_in" || (signInFlowStarted && showPasswordLogin)) && (
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
                              ? "Login"
                              : "Create Account"}
                      </Button>
                    )}
                    {!isResetMode && mode === "sign_in" && signInFlowStarted && canUseOtpAndPasskey && !useEmailCode && showPasswordLogin && (
                      <>
                        <div className="flex items-center gap-3">
                          <div className="h-px flex-1 bg-border" />
                          <span className="text-xs text-muted-foreground">or</span>
                          <div className="h-px flex-1 bg-border" />
                        </div>
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() => {
                            setShowPasswordLogin(false);
                            setUseEmailCode(true);
                            setForgotRequested(false);
                            setPassword("");
                            setCodeSent(false);
                            setOtpDigits(Array.from({ length: OTP_LENGTH }, () => ""));
                            setEmailCode("");
                            setCodeSuccess(null);
                            setError(null);
                            sendCodeMutation.mutate();
                          }}
                          className="w-full"
                        >
                          <Mail className="mr-2 h-4 w-4 text-sky-600 dark:text-sky-400" />
                          Login with Email OTP
                        </Button>
                        <Button
                          type="button"
                          variant="secondary"
                          disabled={passkeyMutation.isPending}
                          onClick={() => {
                            setError(null);
                            passkeyMutation.mutate();
                          }}
                          className="w-full"
                        >
                          <KeyRound className="mr-2 h-4 w-4 text-blue-600 dark:text-blue-400" />
                          {passkeyMutation.isPending ? "Opening Passkey..." : "Login with Passkey"}
                        </Button>
                        <Button
                          type="button"
                          variant="secondary"
                          disabled={microsoftMutation.isPending || passkeyMutation.isPending}
                          onClick={() => {
                            setError(null);
                            microsoftMutation.mutate();
                          }}
                          className="w-full"
                        >
                          <MicrosoftLogo className="mr-2 h-4 w-4" />
                          {microsoftMutation.isPending ? "Opening Microsoft..." : "Login with Microsoft"}
                        </Button>
                      </>
                    )}
                  </>
                )}
                
              </>
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
