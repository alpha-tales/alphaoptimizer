import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
const run = promisify(execFile);
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "alpha-package-"));
try {
  await run("npm", ["pack", "--pack-destination", temporary], {
    timeout: 120000,
  });
  const archive = (await fs.readdir(temporary)).find((name) =>
    name.endsWith(".tgz"),
  )!;
  const install = path.join(temporary, "install");
  await fs.mkdir(install);
  await run(
    "npm",
    [
      "install",
      "--prefix",
      install,
      "--omit=dev",
      "--no-audit",
      "--no-fund",
      path.join(temporary, archive),
    ],
    { timeout: 120000 },
  );
  const configPath = path.join(
    install,
    "node_modules",
    "alphaoptimizer",
    ".mcp.json",
  );
  const text = await fs.readFile(configPath, "utf8");
  assert.ok(!text.includes("/Users/") && !text.includes(process.cwd()));
  const configuration = JSON.parse(text).mcpServers.alphaoptimizer;
  const workspace = path.join(temporary, "unrelated-project");
  await fs.mkdir(workspace);
  const client = new Client({ name: "installed-package-smoke", version: "1" });
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
  const transport = new StdioClientTransport({
    command: configuration.command,
    args: configuration.args,
    cwd: workspace,
    env: {
      ...environment,
      ...configuration.env,
      PATH: `${path.join(install, "node_modules", ".bin")}${path.delimiter}${process.env.PATH}`,
      ALPHAOPTIMIZER_DATA_DIR: path.join(temporary, "data"),
    },
  });
  try {
    await client.connect(transport);
    assert.ok((await client.listTools()).tools.some((tool) => tool.name === "process_tool_result"));
    const result = await client.callTool({
      name: "select_evidence",
      arguments: { workspace, content: "synthetic installed evidence" },
    });
    assert.ok(!result.isError);
    const receipt = JSON.parse(
      (result.content as Array<{ text: string }>)[0].text,
    );
    assert.ok(receipt.artifact.artifactId);
  } finally {
    await client.close();
  }
  console.log(
    "PASS: packed package installed separately; shipped MCP command initialized from unrelated cwd and captured evidence.",
  );
} finally {
  await fs.rm(temporary, { recursive: true, force: true });
}
