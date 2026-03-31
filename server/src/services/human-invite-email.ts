import net from "node:net";
import tls from "node:tls";

export type HumanInviteEmailInput = {
  toEmail: string;
  toName: string;
  temporaryUsername: string;
  temporaryPassword: string;
  signInUrl: string;
};

export type HumanInviteEmailDelivery = {
  status: "sent" | "skipped" | "failed";
  message: string;
};

export type SystemEmailInput = {
  toEmail: string;
  subject: string;
  textBody: string;
};

type SmtpConfig = {
  host: string;
  port: number;
  secure: boolean;
  from: string;
  heloHost: string;
  auth?: {
    user: string;
    pass: string;
  };
};

function parseBoolean(value: string | undefined): boolean | null {
  if (value === undefined) return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes") {
    return true;
  }
  if (normalized === "false" || normalized === "0" || normalized === "no") {
    return false;
  }
  return null;
}

function resolveSmtpConfig(): SmtpConfig | null {
  const host = process.env.SMTP_HOST?.trim();
  const portRaw = process.env.SMTP_PORT?.trim();
  const from = process.env.SMTP_FROM?.trim();
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS?.trim();
  const secureRaw = process.env.SMTP_SECURE;
  const heloHost = process.env.SMTP_HELO_HOST?.trim() || "localhost";

  const hasAnyConfig =
    Boolean(host) ||
    Boolean(portRaw) ||
    Boolean(from) ||
    Boolean(user) ||
    Boolean(pass) ||
    secureRaw !== undefined;
  if (!hasAnyConfig) return null;

  if (!host) {
    throw new Error("SMTP_HOST is required when SMTP email is configured");
  }
  if (!portRaw) {
    throw new Error("SMTP_PORT is required when SMTP email is configured");
  }
  const port = Number.parseInt(portRaw, 10);
  if (!Number.isFinite(port) || port <= 0) {
    throw new Error(`SMTP_PORT must be a positive integer (received: ${portRaw})`);
  }
  if (!from) {
    throw new Error("SMTP_FROM is required when SMTP email is configured");
  }
  if ((user && !pass) || (!user && pass)) {
    throw new Error("SMTP_USER and SMTP_PASS must be provided together");
  }

  const secureParsed = parseBoolean(secureRaw);
  if (secureRaw !== undefined && secureParsed === null) {
    throw new Error(`SMTP_SECURE must be true/false (received: ${secureRaw})`);
  }

  return {
    host,
    port,
    from,
    secure: secureParsed ?? port === 465,
    heloHost,
    auth: user && pass ? { user, pass } : undefined
  };
}

function base64(input: string) {
  return Buffer.from(input, "utf8").toString("base64");
}

function createSocket(config: SmtpConfig): Promise<net.Socket | tls.TLSSocket> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    if (config.secure) {
      const socket = tls.connect(
        { host: config.host, port: config.port, servername: config.host },
        () => resolve(socket)
      );
      socket.once("error", onError);
      return;
    }
    const socket = net.connect({ host: config.host, port: config.port }, () =>
      resolve(socket)
    );
    socket.once("error", onError);
  });
}

async function readSmtpResponse(
  socket: net.Socket | tls.TLSSocket
): Promise<{ code: number; lines: string[] }> {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const onData = (chunk: Buffer | string) => {
      buffer += chunk.toString();
      const lines = buffer
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      if (lines.length === 0) return;
      const lastLine = lines[lines.length - 1]!;
      const match = /^(\d{3})([\s-])/.exec(lastLine);
      if (!match) return;
      if (match[2] === "-") return;
      cleanup();
      resolve({ code: Number.parseInt(match[1]!, 10), lines });
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onEnd = () => {
      cleanup();
      reject(new Error("SMTP connection closed before response"));
    };
    const cleanup = () => {
      socket.off("data", onData);
      socket.off("error", onError);
      socket.off("end", onEnd);
    };
    socket.on("data", onData);
    socket.on("error", onError);
    socket.on("end", onEnd);
  });
}

async function sendSmtpCommand(input: {
  socket: net.Socket | tls.TLSSocket;
  command: string;
  expect: number[];
}) {
  input.socket.write(`${input.command}\r\n`);
  const response = await readSmtpResponse(input.socket);
  if (!input.expect.includes(response.code)) {
    throw new Error(
      `SMTP command failed (${input.command.split(" ")[0]}): ${response.lines.join(" | ")}`
    );
  }
}

async function sendViaSmtp(input: {
  config: SmtpConfig;
  toEmail: string;
  subject: string;
  textBody: string;
}) {
  const socket = await createSocket(input.config);
  try {
    const greeting = await readSmtpResponse(socket);
    if (greeting.code !== 220) {
      throw new Error(`SMTP greeting failed: ${greeting.lines.join(" | ")}`);
    }

    await sendSmtpCommand({
      socket,
      command: `EHLO ${input.config.heloHost}`,
      expect: [250]
    });

    if (input.config.auth) {
      await sendSmtpCommand({
        socket,
        command: "AUTH LOGIN",
        expect: [334]
      });
      await sendSmtpCommand({
        socket,
        command: base64(input.config.auth.user),
        expect: [334]
      });
      await sendSmtpCommand({
        socket,
        command: base64(input.config.auth.pass),
        expect: [235]
      });
    }

    await sendSmtpCommand({
      socket,
      command: `MAIL FROM:<${input.config.from}>`,
      expect: [250]
    });
    await sendSmtpCommand({
      socket,
      command: `RCPT TO:<${input.toEmail}>`,
      expect: [250, 251]
    });
    await sendSmtpCommand({ socket, command: "DATA", expect: [354] });

    const headers = [
      `From: ${input.config.from}`,
      `To: ${input.toEmail}`,
      `Subject: ${input.subject}`,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=UTF-8"
    ];
    const escapedBody = input.textBody
      .replace(/\r?\n/g, "\r\n")
      .replace(/^\./gm, "..");
    socket.write(`${headers.join("\r\n")}\r\n\r\n${escapedBody}\r\n.\r\n`);
    const dataResponse = await readSmtpResponse(socket);
    if (dataResponse.code !== 250) {
      throw new Error(`SMTP DATA failed: ${dataResponse.lines.join(" | ")}`);
    }

    await sendSmtpCommand({ socket, command: "QUIT", expect: [221, 250] });
  } finally {
    socket.destroy();
  }
}

export async function sendHumanInviteEmail(
  input: HumanInviteEmailInput
): Promise<HumanInviteEmailDelivery> {
  const delivery = await sendSystemEmail({
    toEmail: input.toEmail,
    subject: "You have been invited to Paperclip",
    textBody: [
      `Hello ${input.toName},`,
      "",
      "You have been granted access to Paperclip.",
      "",
      `Sign in: ${input.signInUrl}`,
      `Email: ${input.temporaryUsername}`,
      `Temporary password: ${input.temporaryPassword}`,
      "",
      "Please sign in and change your password."
    ].join("\n"),
  });
  if (delivery.status === "sent") {
    return { ...delivery, message: `Invite email sent to ${input.toEmail}` };
  }
  if (delivery.status === "failed") {
    return { ...delivery, message: delivery.message.replace("Failed to send email:", "Failed to send invite email:") };
  }
  return delivery;
}

export async function sendSystemEmail(input: SystemEmailInput): Promise<HumanInviteEmailDelivery> {
  try {
    const smtpConfig = resolveSmtpConfig();
    if (!smtpConfig) {
      return {
        status: "skipped",
        message:
          "SMTP is not configured. Set SMTP_HOST/SMTP_PORT/SMTP_FROM to send invite emails automatically."
      };
    }

    await sendViaSmtp({
      config: smtpConfig,
      toEmail: input.toEmail,
      subject: input.subject,
      textBody: input.textBody,
    });

    return {
      status: "sent",
      message: `Email sent to ${input.toEmail}`
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      status: "failed",
      message: `Failed to send email: ${message}`
    };
  }
}
