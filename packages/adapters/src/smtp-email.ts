import type { TransactionalEmail, TransactionalEmailProvider } from "@rakazo/adapter-kit";
import nodemailer, { type Transporter } from "nodemailer";

export interface SmtpEmailConfig {
  url: string;
  from: string;
}

/** SMTP delivery works with SES, Resend, and self-hosted mail servers. */
export class SmtpEmailProvider implements TransactionalEmailProvider {
  private readonly transport: Transporter;

  constructor(
    private readonly config: SmtpEmailConfig,
    dependencies: { transport?: Transporter } = {},
  ) {
    const protocol = safeProtocol(config.url);
    if (protocol !== "smtp:" && protocol !== "smtps:") {
      throw new Error("SMTP_URL must use smtp:// or smtps://");
    }
    if (!config.from.trim()) throw new Error("EMAIL_FROM is required when SMTP_URL is configured");
    this.transport = dependencies.transport ?? nodemailer.createTransport(config.url);
  }

  describe() {
    return {
      id: "smtp",
      contractVersion: "1",
      adapterVersion: "0.1.0",
      capabilities: { transactional: true },
    };
  }

  async send(message: TransactionalEmail): Promise<void> {
    await this.transport.sendMail({
      from: this.config.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
  }
}

function safeProtocol(value: string): string | undefined {
  try {
    return new URL(value).protocol;
  } catch {
    return undefined;
  }
}
