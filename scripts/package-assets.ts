import fs from "node:fs/promises";
import { automaticHookGroup } from "../src/hooks/definition.js";

await fs.mkdir("hooks", { recursive: true });
await fs.writeFile("hooks/hooks.json", JSON.stringify({
  hooks: {
    SessionStart: [{ hooks: [{
      type: "command",
      command: 'node "${PLUGIN_ROOT}/dist/src/hooks/session-start.js"',
      commandWindows: 'node "${PLUGIN_ROOT}/dist/src/hooks/session-start.js"',
      timeout: 5,
    }] }],
    PostToolUse: [automaticHookGroup],
  },
}, null, 2) + "\n");
await fs.copyFile("package-lock.json", "runtime-lock.json");
