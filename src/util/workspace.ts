import fs from "node:fs";
import path from "node:path";

export function canonicalizeWorkspace(workspace: string): string {
  return fs.realpathSync(path.resolve(workspace));
}

export function assertWorkspaceAllowed(workspace: string, allowlist: string[]): string {
  const canonical = canonicalizeWorkspace(workspace);
  if (allowlist.length === 0) return canonical;

  const allowed = allowlist.map((entry) => canonicalizeWorkspace(entry));
  if (!allowed.includes(canonical)) {
    throw new Error(`Workspace is not allowlisted: ${canonical}`);
  }
  return canonical;
}

export function assertPathInsideWorkspace(workspace: string, target: string): string {
  const root = canonicalizeWorkspace(workspace);
  const absolute = path.isAbsolute(target) ? target : path.resolve(root, target);
  const resolved = fs.existsSync(absolute) ? fs.realpathSync(absolute) : absolute;
  const relative = path.relative(root, resolved);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Path escapes workspace: ${target}`);
  }
  return resolved;
}

export function assertScopeAllowed(input: { workspaceId: string; sessionId: string }, allowlist: string[]): {
  workspaceId: string;
  sessionId: string;
} {
  return {
    workspaceId: assertWorkspaceAllowed(input.workspaceId, allowlist),
    sessionId: input.sessionId
  };
}
