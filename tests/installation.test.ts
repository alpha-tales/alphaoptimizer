import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { automaticHookGroup } from "../src/hooks/definition.js";

it("enables automatic filtering with only a Jev key while respecting explicit opt-outs", () => {
  const config = loadConfig({ ALPHAOPTIMIZER_JEV_API_KEY: "synthetic" });
  expect(config.mode).toBe("filter");
  expect(config.autoMode).toBe("filter");
  expect(loadConfig({ ALPHAOPTIMIZER_AUTO_MODE: "off" }).autoMode).toBe("off");
  expect(loadConfig({ ALPHAOPTIMIZER_MODE: "off" }).mode).toBe("off");
});

it("does not split Windows drive letters in workspace allowlists", () => {
  const workspaces = process.platform === "win32"
    ? ["C:\\Users\\Owner\\Project", "D:\\Other Project"] : ["/first/project", "/other project"];
  expect(loadConfig({ ALPHAOPTIMIZER_WORKSPACES: workspaces.join(path.delimiter) }).workspaceAllowlist)
    .toEqual(workspaces);
});

it("ships native hooks and emits code-mode policy without modifying user instructions", () => {
  const hooks = JSON.parse(fs.readFileSync("hooks/hooks.json", "utf8")).hooks;
  expect(hooks.PostToolUse).toEqual([automaticHookGroup]);
  const feedback = JSON.parse(execFileSync(process.execPath, ["dist/src/hooks/session-start.js"], { encoding: "utf8" }));
  expect(feedback.hookSpecificOutput.hookEventName).toBe("SessionStart");
  expect(feedback.hookSpecificOutput.additionalContext).toContain("inside the SAME script");
  expect(feedback.hookSpecificOutput.additionalContext).toContain("optimization_status");
  expect(hooks.SessionStart[0].hooks[0].commandWindows).toBeTruthy();
});
