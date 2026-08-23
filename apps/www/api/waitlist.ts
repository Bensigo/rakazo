import {
  captureWaitlistSignup,
  normalizeWaitlistEmail,
  parseWaitlistBody,
} from "../src/waitlist.js";

const MAX_BODY_BYTES = 2_048;

type WaitlistRequest = {
  body?: unknown;
  headers: Record<string, string | string[] | undefined>;
  method?: string;
};

type WaitlistResponse = {
  json: (body: unknown) => WaitlistResponse;
  setHeader: (name: string, value: string) => void;
  status: (code: number) => WaitlistResponse;
};

export default async function handler(request: WaitlistRequest, response: WaitlistResponse) {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Allow", "POST");

  if (request.method !== "POST") {
    return response.status(405).json({ error: "Method not allowed" });
  }

  const contentLength = Number(request.headers["content-length"] ?? 0);
  if (contentLength > MAX_BODY_BYTES) {
    return response.status(400).json({ error: "Invalid request" });
  }

  const body = parseWaitlistBody(request.body);
  if (!body) {
    return response.status(400).json({ error: "Enter a valid email address" });
  }

  // A hidden field catches basic form spam without confirming the trap to bots.
  if (body.company?.trim()) {
    return response.status(200).json({ ok: true });
  }

  const email = normalizeWaitlistEmail(body.email);
  if (!email) {
    return response.status(400).json({ error: "Enter a valid email address" });
  }

  const captured = await captureWaitlistSignup(email, process.env).catch(() => false);
  if (!captured) {
    return response.status(503).json({ error: "Waitlist is temporarily unavailable" });
  }

  return response.status(200).json({ ok: true });
}
