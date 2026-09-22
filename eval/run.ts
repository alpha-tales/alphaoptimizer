import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "../src/config.js";
import { VERSION } from "../src/contracts/schemas.js";
import { AlphaOptimizerEngine } from "../src/optimizer.js";
import { sha256 } from "../src/util/hash.js";

const fixtureDir = path.resolve("tests/fixtures");
const config = loadConfig({
  ...process.env,
  ALPHAOPTIMIZER_MODE: "observe",
  ALPHAOPTIMIZER_DATA_DIR: path.join(process.cwd(), ".alphaoptimizer-eval"),
  ALPHAOPTIMIZER_SELECTION_THRESHOLD_TOKENS: "1"
});
const engine = new AlphaOptimizerEngine(config);

for (const file of fs.readdirSync(fixtureDir).filter((name) => name.endsWith(".txt"))) {
  const content = fs.readFileSync(path.join(fixtureDir, file), "utf8");
  const result = await engine.captureAndSelect({
    schemaVersion: VERSION,
    workspaceId: process.cwd(),
    sessionId: "eval",
    toolCallId: file,
    toolName: "fixture",
    inputHash: sha256(file),
    status: "unknown",
    responseType: "text",
    captureCompleteness: "complete",
    privacyClass: "normal",
    content
  }, { goal: file });
  console.log(JSON.stringify({
    file,
    artifactId: result.artifact?.artifactId ?? null,
    selectedChunks: result.selection?.selectedChunkIds.length ?? 0,
    omittedChunks: result.selection?.omittedChunkCount ?? 0
  }));
}

engine.store.close();
