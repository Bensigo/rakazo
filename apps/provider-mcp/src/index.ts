import {
  ChatSdkMessagingSurface,
  messagingPlatformsFromEnv,
  SmtpEmailProvider,
  sendExpoPushToken,
} from "@rakazo/adapters";
import { createProviderMcpHttpServer } from "./server.js";

const service = createProviderMcpHttpServer({
  token: process.env.MANAGED_PROVIDER_MCP_TOKEN ?? "",
  host: process.env.MANAGED_PROVIDER_MCP_HOST ?? "127.0.0.1",
  port: Number(process.env.MANAGED_PROVIDER_MCP_PORT ?? 3180),
  services: {
    messagingFactory: (() => {
      const platforms = messagingPlatformsFromEnv({
        sendblueApiKeyId: process.env.SENDBLUE_API_KEY_ID,
        sendblueApiSecret: process.env.SENDBLUE_API_SECRET,
        sendblueSigningSecret: process.env.SENDBLUE_SIGNING_SECRET,
        sendbluePhoneNumber: process.env.SENDBLUE_PHONE_NUMBER,
        slackBotToken: process.env.SLACK_BOT_TOKEN,
        slackSigningSecret: process.env.SLACK_SIGNING_SECRET,
        whatsappAccessToken: process.env.WHATSAPP_ACCESS_TOKEN,
        whatsappPhoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
        whatsappAppSecret: process.env.WHATSAPP_APP_SECRET,
        whatsappVerifyToken: process.env.WHATSAPP_VERIFY_TOKEN,
        telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
        telegramWebhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET_TOKEN,
      });
      return platforms.length ? () => new ChatSdkMessagingSurface(platforms) : undefined;
    })(),
    email:
      process.env.SMTP_URL && process.env.EMAIL_FROM
        ? new SmtpEmailProvider({ url: process.env.SMTP_URL, from: process.env.EMAIL_FROM })
        : undefined,
    push: (token, message) => sendExpoPushToken(token, message),
  },
});
await service.listen();
console.log("managed provider MCP server listening");
