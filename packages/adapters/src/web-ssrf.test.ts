import { describe, expect, it } from "vitest";
import { assertSafeWebUrl, fetchSafeWebText, isBlockedHostname } from "./web-ssrf.js";

const publicResolver = async () => [{ address: "203.0.113.10", family: 4 as const }];

describe("web SSRF policy", () => {
  it.each([
    "http://localhost/x",
    "https://127.0.0.1/x",
    "http://10.0.0.1/x",
    "https://192.168.1.1/x",
    "http://169.254.169.254/latest/meta-data",
    "https://[::1]/",
    "http://[::]/",
    "file:///etc/passwd",
    "gopher://example.test/1",
    "ftp://example.test/file",
  ])("rejects unsafe URL %s", async (url) => {
    await expect(assertSafeWebUrl(url, publicResolver)).rejects.toThrow();
  });

  it("accepts public http and https URLs", async () => {
    await expect(assertSafeWebUrl("https://example.test/page", publicResolver)).resolves.toEqual(
      new URL("https://example.test/page"),
    );
    await expect(assertSafeWebUrl("http://example.test/page", publicResolver)).resolves.toEqual(
      new URL("http://example.test/page"),
    );
  });

  it("rejects hosts that resolve privately", async () => {
    await expect(
      assertSafeWebUrl("https://example.test/page", async () => [
        { address: "10.1.2.3", family: 4 as const },
      ]),
    ).rejects.toThrow(/private address/i);
  });

  it("blocks private hostnames before DNS", () => {
    expect(isBlockedHostname("localhost")).toBe(true);
    expect(isBlockedHostname("127.0.0.1")).toBe(true);
    expect(isBlockedHostname("10.2.3.4")).toBe(true);
    expect(isBlockedHostname("192.168.0.9")).toBe(true);
    expect(isBlockedHostname("169.254.1.1")).toBe(true);
    expect(isBlockedHostname("::1")).toBe(true);
    expect(isBlockedHostname("example.test")).toBe(false);
  });

  it("re-validates redirect targets and blocks redirect-to-private", async () => {
    const fetchMock: typeof fetch = async (input) => {
      const href = String(input);
      if (href === "https://example.test/start") {
        return new Response(null, {
          status: 302,
          headers: { location: "http://127.0.0.1/secret" },
        });
      }
      throw new Error(`unexpected fetch ${href}`);
    };

    await expect(
      fetchSafeWebText("https://example.test/start", {
        fetch: fetchMock,
        resolveHostname: publicResolver,
      }),
    ).rejects.toThrow(/private|internal/i);
  });

  it("follows a public redirect and returns the final body", async () => {
    const fetchMock: typeof fetch = async (input) => {
      const href = String(input);
      if (href === "https://example.test/start") {
        return new Response(null, {
          status: 302,
          headers: { location: "https://example.test/final" },
        });
      }
      if (href === "https://example.test/final") {
        return new Response("<html><title>Ok</title><body>hello</body></html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        });
      }
      throw new Error(`unexpected fetch ${href}`);
    };

    const result = await fetchSafeWebText("https://example.test/start", {
      fetch: fetchMock,
      resolveHostname: publicResolver,
    });
    expect(result.url).toBe("https://example.test/final");
    expect(result.body).toContain("hello");
  });
});
