import { describe, expect, it } from "vitest";
import { oauthCallbackFrom } from "./oauth-callback.js";

describe("loopback OAuth callbacks", () => {
  it("reads the code and state Anthropic redirects with", () => {
    expect(
      oauthCallbackFrom("http://localhost:53692/callback?code=ac_123&state=verifier_456"),
    ).toEqual({ code: "ac_123", state: "verifier_456" });
  });

  it("accepts the loopback addresses a provider may redirect to", () => {
    expect(oauthCallbackFrom("http://127.0.0.1:53692/callback?code=ac_123")).toEqual({
      code: "ac_123",
    });
    expect(oauthCallbackFrom("http://[::1]:53692/callback?code=ac_123")).toEqual({
      code: "ac_123",
    });
  });

  it("omits state when the provider redirects without one", () => {
    expect(oauthCallbackFrom("http://localhost:53692/callback?code=ac_123")).toEqual({
      code: "ac_123",
    });
  });

  it("ignores the authorize page and other steps of the flow", () => {
    expect(oauthCallbackFrom("https://claude.ai/oauth/authorize?code=true")).toBeUndefined();
    expect(oauthCallbackFrom("http://localhost:53692/callback")).toBeUndefined();
    expect(oauthCallbackFrom("http://localhost:5173/")).toBeUndefined();
  });

  it("does not treat a remote host as a loopback callback", () => {
    expect(oauthCallbackFrom("https://example.com/callback?code=ac_123")).toBeUndefined();
    expect(oauthCallbackFrom("https://localhost.example.com/callback?code=ac_123")).toBeUndefined();
  });

  it("ignores non-http schemes and unparseable targets", () => {
    expect(oauthCallbackFrom("file:///callback?code=ac_123")).toBeUndefined();
    expect(oauthCallbackFrom("rakazo://localhost/callback?code=ac_123")).toBeUndefined();
    expect(oauthCallbackFrom("not a url")).toBeUndefined();
  });
});
