import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { searchRepository } from "../src/repository/search.js";
const dirs: string[] = [];
function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "alpha-async-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  vi.unstubAllEnvs();
  for (const dir of dirs.splice(0))
    fs.rmSync(dir, { recursive: true, force: true });
});
function delayedRg() {
  const bin = fixture();
  fs.writeFileSync(
    path.join(bin, "rg"),
    `#!${process.execPath}\nsetTimeout(() => process.exit(1), 300);\n`,
    { mode: 0o700 },
  );
  vi.stubEnv("PATH", `${bin}${path.delimiter}${process.env.PATH}`);
}
describe("nonblocking search", () => {
  it("allows timers and a second request to progress while ripgrep runs", async () => {
    delayedRg();
    const workspace = fixture();
    let done = false;
    const first = searchRepository({ workspace, query: "needle" }).then(
      (value) => {
        done = true;
        return value;
      },
    );
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(done).toBe(false);
    await expect(
      searchRepository({
        workspace,
        query: "needle",
        signal: AbortSignal.abort(),
      }),
    ).rejects.toThrow();
    await expect(first).resolves.toEqual([]);
  });
  it("aborts a running subprocess promptly", async () => {
    delayedRg();
    const controller = new AbortController();
    const search = searchRepository({
      workspace: fixture(),
      query: "needle",
      signal: controller.signal,
    });
    const assertion = expect(search).rejects.toThrow();
    setTimeout(() => controller.abort(), 30);
    await assertion;
  });
  it("fails closed for an invalid regex and scan overflow", async () => {
    const workspace = fixture();
    fs.writeFileSync(path.join(workspace, "a.txt"), "needle");
    fs.writeFileSync(path.join(workspace, "b.txt"), "needle");
    await expect(searchRepository({ workspace, query: "[" })).rejects.toThrow();
    await expect(
      searchRepository({ workspace, query: "needle absent", maxScanFiles: 1 }),
    ).rejects.toThrow(/scan limit/);
  });
  it("applies directory exclusions to exact and lexical paths", async () => {
    const workspace = fixture();
    fs.mkdirSync(path.join(workspace, "node_modules"));
    fs.writeFileSync(path.join(workspace, "node_modules", "a.txt"), "needle");
    expect(await searchRepository({ workspace, query: "needle" })).toEqual([]);
    expect(
      await searchRepository({ workspace, query: "needle absent" }),
    ).toEqual([]);
  });
});
