import { describe, expect, it, vi } from "vitest";
import { SmtpEmailProvider } from "./smtp-email.js";

describe("SmtpEmailProvider", () => {
  it("delivers product-authored content through the injected transport", async () => {
    const sendMail = vi.fn(async () => ({ messageId: "message-1" }));
    const provider = new SmtpEmailProvider(
      { url: "smtps://user:secret@smtp.example.test:465", from: "Rakazo <no-reply@example.test>" },
      { transport: { sendMail } as never },
    );

    await provider.send({
      to: "ada@example.test",
      subject: "Reset password",
      text: "Plain text",
      html: "<p>HTML</p>",
    });

    expect(provider.describe().id).toBe("smtp");
    expect(sendMail).toHaveBeenCalledWith({
      from: "Rakazo <no-reply@example.test>",
      to: "ada@example.test",
      subject: "Reset password",
      text: "Plain text",
      html: "<p>HTML</p>",
    });
  });

  it("retries transient failures and drains tracked delivery", async () => {
    const sendMail = vi
      .fn()
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockResolvedValue({ messageId: "message-1" });
    const sleep = vi.fn(async () => undefined);
    const provider = new SmtpEmailProvider(
      { url: "smtp://smtp.example.test", from: "a@example.test" },
      { transport: { sendMail } as never, sleep },
    );

    const delivery = provider.send({
      to: "ada@example.test",
      subject: "Reset password",
      text: "Use this link",
    });
    await provider.drain();
    await expect(delivery).resolves.toBeUndefined();

    expect(sendMail).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls).toEqual([[250], [1_000]]);
  });

  it("rejects unsafe transports and incomplete sender configuration", () => {
    expect(
      () => new SmtpEmailProvider({ url: "https://smtp.example.test", from: "a@example.test" }),
    ).toThrow("SMTP_URL must use smtp:// or smtps://");
    expect(() => new SmtpEmailProvider({ url: "smtp://smtp.example.test", from: "" })).toThrow(
      "EMAIL_FROM is required",
    );
  });
});
