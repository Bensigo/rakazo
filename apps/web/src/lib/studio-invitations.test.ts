import { describe, expect, it } from "vitest";
import { safeAuthNext } from "./studio-invitations";

describe("invitation auth continuation", () => {
  it("keeps only local application paths", () => {
    expect(safeAuthNext("/invite/invitation-1?source=email")).toBe(
      "/invite/invitation-1?source=email",
    );
    expect(safeAuthNext("https://attacker.example/invite/1")).toBeNull();
    expect(safeAuthNext("//attacker.example/invite/1")).toBeNull();
    expect(safeAuthNext("invite/1")).toBeNull();
  });
});
