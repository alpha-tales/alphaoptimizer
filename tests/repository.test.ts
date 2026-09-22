import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { searchRepository } from "../src/repository/search.js";

describe("repository search", () => {
  it("returns exact excerpts with hashes", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "alphaoptimizer-repo-"));
    fs.writeFileSync(path.join(dir, "alpha.ts"), "export const answer = 42;\nexport const needle = 'alpha';\n");

    const results = await searchRepository({
      workspace: dir,
      query: "needle",
      limit: 1,
      contextLines: 1
    });

    expect(results).toHaveLength(1);
    expect(results[0].path).toBe("alpha.ts");
    expect(results[0].excerpt).toContain("needle");
    expect(results[0].contentHash).toHaveLength(64);
  });

  it("does not broaden to gitignored files when ripgrep enumerates zero candidates", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "alphaoptimizer-ignored-"));
    fs.writeFileSync(path.join(dir, ".gitignore"), "*\n");
    fs.writeFileSync(path.join(dir, "private.txt"), "pear absent synthetic private data\n");

    const results = await searchRepository({
      workspace: dir,
      query: "pear absent",
      limit: 10
    });

    expect(results).toEqual([]);
  });
});
