import type { Request, RequestHandler } from "express";
import type { IncomingHttpHeaders } from "node:http";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { toNodeHandler } from "better-auth/node";
import { emailOTP } from "better-auth/plugins";
import { passkey } from "@better-auth/passkey";
import type { Db } from "@paperclipai/db";
import {
  authAccounts,
  authSessions,
  authPasskeys,
  authUsers,
  authVerifications,
} from "@paperclipai/db";
import type { Config } from "../config.js";
import { logger } from "../middleware/logger.js";
import { buildPasswordResetEmailBodies, sendSystemEmail } from "../services/human-invite-email.js";

export type BetterAuthSessionUser = {
  id: string;
  email?: string | null;
  name?: string | null;
};

export type BetterAuthSessionResult = {
  session: { id: string; userId: string } | null;
  user: BetterAuthSessionUser | null;
};

type BetterAuthInstance = ReturnType<typeof betterAuth>;

function headersFromNodeHeaders(rawHeaders: IncomingHttpHeaders): Headers {
  const headers = new Headers();
  for (const [key, raw] of Object.entries(rawHeaders)) {
    if (!raw) continue;
    if (Array.isArray(raw)) {
      for (const value of raw) headers.append(key, value);
      continue;
    }
    headers.set(key, raw);
  }
  return headers;
}

function headersFromExpressRequest(req: Request): Headers {
  return headersFromNodeHeaders(req.headers);
}

export function deriveAuthTrustedOrigins(config: Config): string[] {
  const baseUrl = config.authBaseUrlMode === "explicit" ? config.authPublicBaseUrl : undefined;
  const trustedOrigins = new Set<string>();

  if (baseUrl) {
    try {
      trustedOrigins.add(new URL(baseUrl).origin);
    } catch {
      // Better Auth will surface invalid base URL separately.
    }
  }
  if (config.deploymentMode === "authenticated") {
    for (const hostname of config.allowedHostnames) {
      const trimmed = hostname.trim().toLowerCase();
      if (!trimmed) continue;
      trustedOrigins.add(`https://${trimmed}`);
      trustedOrigins.add(`http://${trimmed}`);
    }
  }

  return Array.from(trustedOrigins);
}

export function createBetterAuthInstance(db: Db, config: Config, trustedOrigins?: string[]): BetterAuthInstance {
  const baseUrl = config.authBaseUrlMode === "explicit" ? config.authPublicBaseUrl : undefined;
  const secret = process.env.BETTER_AUTH_SECRET ?? process.env.PAPERCLIP_AGENT_JWT_SECRET ?? "paperclip-dev-secret";
  const effectiveTrustedOrigins = trustedOrigins ?? deriveAuthTrustedOrigins(config);

  const publicUrl = process.env.PAPERCLIP_PUBLIC_URL ?? baseUrl;
  const isHttpOnly = publicUrl ? publicUrl.startsWith("http://") : false;
  let passkeyOrigin: string | undefined;
  let passkeyRpId: string | undefined;
  if (publicUrl) {
    try {
      const parsed = new URL(publicUrl);
      passkeyOrigin = parsed.origin;
      passkeyRpId = parsed.hostname;
    } catch {
      logger.warn({ publicUrl }, "Better Auth: invalid public URL for passkey origin/rpID");
    }
  }

  if (config.deploymentMode === "authenticated") {
    if (!config.microsoftAuthClientId || !config.microsoftAuthClientSecret) {
      logger.warn(
        "Microsoft OAuth is disabled: set AI_HARNESS_AUTH_MICROSOFT_CLIENT_ID and AI_HARNESS_AUTH_MICROSOFT_CLIENT_SECRET " +
          "(tenant id alone is not enough). Use repo-root `.env` or `server/.env`, then restart the server.",
      );
    }
  }

  const authConfig = {
    baseURL: baseUrl,
    secret,
    trustedOrigins: effectiveTrustedOrigins,
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: {
        user: authUsers,
        session: authSessions,
        account: authAccounts,
        verification: authVerifications,
        passkey: authPasskeys,
      },
    }),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
      disableSignUp: config.authDisableSignUp,
      resetPasswordTokenExpiresIn: 3600, // 1 hour in seconds — token is deleted from DB after successful use
      sendResetPassword: async (params: { user: { email?: string | null }; url: string }) => {
        const email = params.user.email?.trim();
        if (!email) {
          logger.warn({ url: params.url }, "Better Auth: password reset requested for user without an email");
          return;
        }
        const { textBody, htmlBody } = buildPasswordResetEmailBodies({
          resetUrl: params.url,
          recipientEmail: email,
        });
        const delivery = await sendSystemEmail({
          toEmail: email,
          subject: "Reset your AI-Harness password",
          textBody,
          htmlBody,
        });
        if (delivery.status === "failed") {
          logger.error({ email, reason: delivery.message }, "Better Auth: failed to send reset password email");
          return;
        }
        if (delivery.status === "skipped") {
          logger.warn(
            { email, reason: delivery.message, url: params.url },
            "Better Auth: SMTP not configured; reset password email not delivered",
          );
          return;
        }
        logger.info({ email }, "Better Auth: password reset email sent");
      },
    },
    user: {
      changeEmail: {
        enabled: true,
        // Instant update while email is unverified (default for new users); verified users use sendVerificationEmail below.
        updateEmailWithoutVerification: true,
      },
    },
    account: {
      accountLinking: {
        enabled: true,
      },
    },
    emailVerification: {
      sendVerificationEmail: async (params: { user: { email?: string | null }; url: string }) => {
        void params.user;
        logger.info(
          { url: params.url },
          "Better Auth: email verification link (configure outbound email to deliver this to users)",
        );
      },
    },
    socialProviders:
      config.microsoftAuthClientId && config.microsoftAuthClientSecret
        ? {
          microsoft: {
            clientId: config.microsoftAuthClientId,
            clientSecret: config.microsoftAuthClientSecret,
            tenantId: config.microsoftAuthTenantId ?? "common",
          },
        }
        : undefined,
    plugins: [
      emailOTP({
        expiresIn: 10 * 60,
        async sendVerificationOTP(input: { email: string; otp: string; type: string }) {
          const email = input.email.trim().toLowerCase();
          const textBody = [
            "Your AI-Harness sign-in code:",
            "",
            input.otp,
            "",
            "This code expires in 10 minutes.",
            "If you did not request this code, you can ignore this email.",
          ].join("\n");
          const htmlBody = [
            "<p>Your AI-Harness sign-in code:</p>",
            `<p style="font-size: 24px; font-weight: 700; letter-spacing: 0.08em;">${input.otp}</p>`,
            "<p>This code expires in 10 minutes.</p>",
            "<p>If you did not request this code, you can ignore this email.</p>",
          ].join("");
          const delivery = await sendSystemEmail({
            toEmail: email,
            subject: "Your AI-Harness sign-in code",
            textBody,
            htmlBody,
          });
          if (delivery.status === "failed") {
            logger.error({ email, reason: delivery.message, type: input.type }, "Better Auth: failed to send sign-in OTP");
            return;
          }
          if (delivery.status === "skipped") {
            logger.warn(
              { email, reason: delivery.message, type: input.type, otp: input.otp },
              "Better Auth: SMTP not configured; sign-in OTP email not delivered",
            );
            return;
          }
          logger.info({ email, type: input.type }, "Better Auth: sign-in OTP email sent");
        },
      }),
      passkey({
        ...(passkeyOrigin ? { origin: passkeyOrigin } : {}),
        ...(passkeyRpId ? { rpID: passkeyRpId } : {}),
        rpName: "AI-Harness",
      }),
    ],
    ...(isHttpOnly ? { advanced: { useSecureCookies: false } } : {}),
  };

  if (!baseUrl) {
    delete (authConfig as { baseURL?: string }).baseURL;
  }

  return betterAuth(authConfig);
}

export function createBetterAuthHandler(auth: BetterAuthInstance): RequestHandler {
  const handler = toNodeHandler(auth);
  return (req, res, next) => {
    void Promise.resolve(handler(req, res)).catch(next);
  };
}

export async function resolveBetterAuthSessionFromHeaders(
  auth: BetterAuthInstance,
  headers: Headers,
): Promise<BetterAuthSessionResult | null> {
  const api = (auth as unknown as { api?: { getSession?: (input: unknown) => Promise<unknown> } }).api;
  if (!api?.getSession) return null;

  const sessionValue = await api.getSession({
    headers,
  });
  if (!sessionValue || typeof sessionValue !== "object") return null;

  const value = sessionValue as {
    session?: { id?: string; userId?: string } | null;
    user?: { id?: string; email?: string | null; name?: string | null } | null;
  };
  const session = value.session?.id && value.session.userId
    ? { id: value.session.id, userId: value.session.userId }
    : null;
  const user = value.user?.id
    ? {
        id: value.user.id,
        email: value.user.email ?? null,
        name: value.user.name ?? null,
      }
    : null;

  if (!session || !user) return null;
  return { session, user };
}

export async function resolveBetterAuthSession(
  auth: BetterAuthInstance,
  req: Request,
): Promise<BetterAuthSessionResult | null> {
  return resolveBetterAuthSessionFromHeaders(auth, headersFromExpressRequest(req));
}
