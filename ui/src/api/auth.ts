import { createAuthClient } from "better-auth/client";
import { passkeyClient } from "@better-auth/passkey/client";

export type AuthSession = {
  session: { id: string; userId: string };
  user: { id: string; email: string | null; name: string | null; mustChangePassword?: boolean };
};

function resolveBetterAuthBaseUrl(): string {
  if (typeof window !== "undefined") {
    return new URL("/api/auth", window.location.origin).toString();
  }
  return "http://localhost:3100/api/auth";
}

const betterAuthClient = createAuthClient({
  baseURL: resolveBetterAuthBaseUrl(),
  plugins: [passkeyClient()],
});

export type NotificationChannelType = "email" | "sms" | "whatsapp";
export type ProjectNotificationEventType =
  | "issue.status_changed"
  | "issue.comment_added"
  | "issue.comment_mentioned"
  | "issue.assigned";

export type SignInMethodMode = "otp_or_password" | "password_only";

export type UserNotificationPreferences = {
  enabled: boolean;
  defaultChannels: NotificationChannelType[];
  channels: Record<NotificationChannelType, { enabled: boolean; destination: string | null }>;
  events: Partial<Record<ProjectNotificationEventType, { enabled?: boolean; channels?: NotificationChannelType[] }>>;
};

function toSession(value: unknown): AuthSession | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const sessionValue = record.session;
  const userValue = record.user;
  if (!sessionValue || typeof sessionValue !== "object") return null;
  if (!userValue || typeof userValue !== "object") return null;
  const session = sessionValue as Record<string, unknown>;
  const user = userValue as Record<string, unknown>;
  if (typeof session.id !== "string" || typeof session.userId !== "string") return null;
  if (typeof user.id !== "string") return null;
  const mustChangePassword = user.mustChangePassword === true;
  return {
    session: { id: session.id, userId: session.userId },
    user: {
      id: user.id,
      email: typeof user.email === "string" ? user.email : null,
      name: typeof user.name === "string" ? user.name : null,
      mustChangePassword,
    },
  };
}

async function authPost(path: string, body: Record<string, unknown>) {
  const res = await fetch(`/api/auth${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    const p = payload as Record<string, unknown> | null;
    const message =
      (typeof (p?.error as Record<string, unknown> | undefined)?.message === "string"
        ? (p!.error as Record<string, unknown>).message as string
        : null) ??
      (typeof p?.error === "string" ? p.error : null) ??
      (typeof p?.message === "string" ? p.message : null) ??
      `Request failed: ${res.status}`;
    throw new Error(message);
  }
  return payload;
}

async function authPostAllowNotFound(path: string, body: Record<string, unknown>) {
  const res = await fetch(`/api/auth${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.status === 404) {
    return { notFound: true as const };
  }
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    const p = payload as Record<string, unknown> | null;
    const message =
      (typeof (p?.error as Record<string, unknown> | undefined)?.message === "string"
        ? (p!.error as Record<string, unknown>).message as string
        : null) ??
      (typeof p?.error === "string" ? p.error : null) ??
      (typeof p?.message === "string" ? p.message : null) ??
      `Request failed: ${res.status}`;
    throw new Error(message);
  }
  return { notFound: false as const };
}

export const authApi = {
  getSession: async (): Promise<AuthSession | null> => {
    const res = await fetch("/api/auth/get-session", {
      credentials: "include",
      headers: { Accept: "application/json" },
    });
    if (res.status === 401) return null;
    const payload = await res.json().catch(() => null);
    if (!res.ok) {
      throw new Error(`Failed to load session (${res.status})`);
    }
    const direct = toSession(payload);
    if (direct) return direct;
    const nested = payload && typeof payload === "object" ? toSession((payload as Record<string, unknown>).data) : null;
    return nested;
  },

  signInEmail: async (input: { email: string; password: string }) => {
    await authPost("/sign-in/email", input);
  },

  sendEmailSignInCode: async (input: { email: string }) => {
    await authPost("/email-otp/send-verification-otp", {
      email: input.email,
      type: "sign-in",
    });
  },

  getSignInMethod: async (input: { email: string }): Promise<{ mode: SignInMethodMode }> => {
    const payload = await authPost("/sign-in-method", { email: input.email });
    const mode =
      payload && typeof payload === "object" && (payload as { mode?: unknown }).mode === "password_only"
        ? "password_only"
        : "otp_or_password";
    return { mode };
  },

  signInEmailCode: async (input: { email: string; code: string }) => {
    await authPost("/sign-in/email-otp", {
      email: input.email,
      otp: input.code,
    });
  },

  signInPasskey: async () => {
    const result = await betterAuthClient.signIn.passkey();
    if ("error" in result && result.error) {
      const message =
        (typeof result.error.message === "string" && result.error.message.length > 0)
          ? result.error.message
          : "Passkey sign-in failed";
      throw new Error(message);
    }
  },

  signInMicrosoft: async () => {
    const callbackURL =
      typeof window !== "undefined"
        ? `${window.location.origin}/auth`
        : "/auth";
    const result = await betterAuthClient.signIn.social({
      provider: "microsoft",
      callbackURL,
    });
    if ("error" in result && result.error) {
      const message =
        (typeof result.error.message === "string" && result.error.message.length > 0)
          ? result.error.message
          : "Microsoft sign-in failed";
      throw new Error(message);
    }
  },

  addPasskey: async (input?: { name?: string }) => {
    const result = await betterAuthClient.passkey.addPasskey({ name: input?.name });
    if ("error" in result && result.error) {
      const message =
        (typeof result.error.message === "string" && result.error.message.length > 0)
          ? result.error.message
          : "Passkey setup failed";
      throw new Error(message);
    }
  },

  signUpEmail: async (input: { name: string; email: string; password: string }) => {
    await authPost("/sign-up/email", input);
  },

  signOut: async () => {
    const primary = await authPostAllowNotFound("/logout", {});
    if (primary.notFound) {
      await authPost("/sign-out", {});
    }
  },

  changePassword: async (input: { currentPassword: string; newPassword: string }) => {
    try {
      await authPost("/change-password", {
        currentPassword: input.currentPassword,
        newPassword: input.newPassword,
        revokeOtherSessions: false,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message.toLowerCase() : "";
      if (msg.includes("invalid password") || msg.includes("incorrect password")) {
        throw new Error("Current password is incorrect. Please try again.");
      }
      throw err;
    }
  },

  forgotPassword: async (input: { email: string; redirectTo?: string }) => {
    const payload = {
      email: input.email,
      redirectTo: input.redirectTo,
      callbackURL: input.redirectTo,
    };
    // Better Auth v1.4+ uses POST /request-password-reset (see better-auth.com docs).
    const modern = await authPostAllowNotFound("/request-password-reset", payload);
    if (modern.notFound) {
      const legacyA = await authPostAllowNotFound("/forget-password", payload);
      if (legacyA.notFound) {
        await authPost("/forgot-password", payload);
      }
    }
  },

  resetPassword: async (input: { token: string; newPassword: string }) => {
    await authPost("/reset-password", {
      token: input.token,
      newPassword: input.newPassword,
    });
  },

  getNotificationPreferences: async (): Promise<UserNotificationPreferences> => {
    const res = await fetch("/api/users/me/notification-preferences", {
      credentials: "include",
      headers: { Accept: "application/json" },
    });
    const payload = await res.json().catch(() => null);
    if (!res.ok) {
      throw new Error(`Failed to load notification preferences (${res.status})`);
    }
    return payload as UserNotificationPreferences;
  },

  updateProfile: async (input: { name?: string; email?: string }): Promise<void> => {
    if (input.name !== undefined) {
      await authPost("/update-user", { name: input.name });
    }
    if (input.email !== undefined) {
      const callbackURL =
        typeof window !== "undefined"
          ? `${window.location.pathname}${window.location.search}`
          : "/account/settings";
      try {
        await authPost("/change-email", { newEmail: input.email, callbackURL });
      } catch (err) {
        const msg = err instanceof Error ? err.message.toLowerCase() : "";
        if (msg.includes("already exists") || msg.includes("another email")) {
          throw new Error("That email is already in use. Please choose a different address.");
        }
        throw err;
      }
    }
  },

  updateNotificationPreferences: async (input: Partial<UserNotificationPreferences>): Promise<UserNotificationPreferences> => {
    const res = await fetch("/api/users/me/notification-preferences", {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const payload = await res.json().catch(() => null);
    if (!res.ok) {
      const p = payload as Record<string, unknown> | null;
      const message =
        (typeof p?.error === "string" ? p.error : null) ??
        (typeof p?.message === "string" ? p.message : null) ??
        `Failed to update notification preferences (${res.status})`;
      throw new Error(message);
    }
    return payload as UserNotificationPreferences;
  },
};
