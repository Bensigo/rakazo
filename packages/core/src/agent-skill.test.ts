import { describe, expect, it } from "vitest";
import {
  buildSkillMd,
  expandSkillReferencesInPrompt,
  extractForcedSkillName,
  extractRoutineSkillMentions,
  formatSkillsCatalogInstruction,
  parseSkillMd,
} from "./agent-skill.js";

const SAMPLE = `---
name: Daily standup
description: Prepare a concise standup update from recent work. Use when the user asks for standup notes or a status summary.
compatibility: optional-extra
allowed-tools: [shell, read_file]
long-desc: >-
  Folded description that spans
  multiple lines with strip chomping.
literal: |+
  Keep trailing newlines

  And blank lines.
---

# Daily standup

1. Scan recent commits and open tasks.
2. Summarize wins, plans, and blockers.
`;

describe("parseSkillMd", () => {
  it("parses name, description, body, and extra frontmatter keys", () => {
    const parsed = parseSkillMd(SAMPLE);
    expect("error" in parsed).toBe(false);
    if ("error" in parsed) return;
    expect(parsed.name).toBe("Daily standup");
    expect(parsed.description).toContain("standup");
    expect(parsed.body).toContain("# Daily standup");
    expect(parsed.frontmatter.compatibility).toBe("optional-extra");
    expect(parsed.frontmatter["allowed-tools"]).toEqual(["shell", "read_file"]);
    expect(String(parsed.frontmatter["long-desc"])).toBe(
      "Folded description that spans multiple lines with strip chomping.",
    );
    expect(String(parsed.frontmatter.literal)).toContain("Keep trailing newlines");
    expect(String(parsed.frontmatter.literal).endsWith("\n")).toBe(true);
  });

  it("parses block scalar indicators with chomping and indent hints", () => {
    const doc = `---
name: Folded
description: >-
  Multi-line description
  that folds.
notes: |+
  Keep trailing newlines.


indent: |2
  Indented block
chomp-indent: |-2
  Chomp then indent
---

# Body
`;
    const parsed = parseSkillMd(doc);
    expect("error" in parsed).toBe(false);
    if ("error" in parsed) return;
    expect(parsed.description).toBe("Multi-line description that folds.");
    expect(parsed.frontmatter.notes).toBe("Keep trailing newlines.\n\n\n");
    expect(parsed.frontmatter.indent).toBe("Indented block\n");
    expect(parsed.frontmatter["chomp-indent"]).toBe("Chomp then indent");
  });

  it("requires name and description", () => {
    expect(parseSkillMd("---\nname: x\n---\nbody")).toEqual({
      error: "SKILL.md frontmatter requires description.",
    });
    expect(parseSkillMd("no frontmatter")).toMatchObject({ error: expect.any(String) });
  });

  it("rejects overlong names", () => {
    const name = "N".repeat(81);
    expect(parseSkillMd(`---\nname: ${name}\ndescription: ok\n---\nbody`)).toEqual({
      error: "Skill name must be at most 80 characters.",
    });
  });
});

describe("buildSkillMd", () => {
  it("round-trips and preserves extra keys", () => {
    const parsed = parseSkillMd(SAMPLE);
    if ("error" in parsed) throw new Error(parsed.error);
    const rebuilt = buildSkillMd(parsed);
    const again = parseSkillMd(rebuilt);
    if ("error" in again) throw new Error(again.error);
    expect(again.name).toBe(parsed.name);
    expect(again.description).toBe(parsed.description);
    expect(again.frontmatter.compatibility).toBe("optional-extra");
    expect(again.body.trim()).toBe(parsed.body.trim());
  });

  it("rejects overlong structured names", () => {
    expect(() => buildSkillMd({ name: "N".repeat(81), description: "ok", body: "body" })).toThrow(
      /at most 80 characters/,
    );
  });
});

describe("skill prompt helpers", () => {
  it("extracts forced /Name and Use skill: Name", () => {
    expect(extractForcedSkillName("/Daily standup\nplease")).toEqual({
      name: "Daily standup",
      rest: "please",
    });
    expect(extractForcedSkillName("Use skill: Weekly review")).toEqual({
      name: "Weekly review",
      rest: "",
    });
    expect(extractForcedSkillName("/Settings: General")).toBeNull();
  });

  it("extracts @skill mentions from routine prompts", () => {
    expect(extractRoutineSkillMentions("Run @Daily standup, then post to Slack")).toEqual([
      "Daily standup",
    ]);
    expect(extractRoutineSkillMentions("ping @everyone then @Weekly review")).toEqual([
      "Weekly review",
    ]);
  });

  it("expands forced and mentioned skills into the prompt", () => {
    const skills = [
      {
        name: "Daily standup",
        description: "standup",
        source: "user" as const,
        readOnly: false,
        content: SAMPLE,
      },
    ];
    const forced = expandSkillReferencesInPrompt("/Daily standup\nfocus on blockers", skills);
    expect(forced).toContain("Use skill: Daily standup");
    expect(forced).toContain(SAMPLE.trim());
    expect(forced).toContain("focus on blockers");

    const mentioned = expandSkillReferencesInPrompt("Run @Daily standup then email me", skills);
    expect(mentioned).toContain("Use skill: Daily standup");
    expect(mentioned).toContain("then email me");
    expect(mentioned).not.toMatch(/@Daily standup/i);

    // Fire-time expand then run-time expand must not duplicate the body.
    const again = expandSkillReferencesInPrompt(mentioned, skills);
    expect(again).toBe(mentioned);
    expect(again.split(SAMPLE.trim()).length - 1).toBe(1);
  });

  it("builds catalog instructions for auto-use", () => {
    const line = formatSkillsCatalogInstruction([
      {
        name: "Daily standup",
        description: "Prepare standup notes",
        source: "user",
        readOnly: false,
      },
    ]);
    expect(line).toContain("- Daily standup: Prepare standup notes");
    expect(line).toContain("skill_read");
    expect(line).toContain("Prefer matching skills");
  });
});
