import fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { sha256 } from "../util/hash.js";
const runFile = promisify(execFile);
const EXCLUDES = ["node_modules", ".git", "dist", ".next", "coverage"]
    .map((name) => `**/${name}/**`)
    .concat([
    "**/.env",
    "**/.env.*",
    "**/*secret*",
    "**/*credential*",
    "**/*token*",
    "**/*.{png,jpg,jpeg,gif,pdf}",
]);
const Limits = z.object({
    limit: z.number().int().min(1).max(50).default(10),
    contextLines: z.number().int().min(0).max(20).default(3),
    maxFileBytes: z
        .number()
        .int()
        .positive()
        .max(8 * 1024 * 1024)
        .default(512 * 1024),
    maxScanFiles: z.number().int().positive().max(10000).default(2000),
    maxScanBytes: z
        .number()
        .int()
        .positive()
        .max(256 * 1024 * 1024)
        .default(32 * 1024 * 1024),
});
export async function searchRepository(input) {
    const limits = Limits.parse(input);
    const signal = input.signal
        ? AbortSignal.any([input.signal, AbortSignal.timeout(10000)])
        : AbortSignal.timeout(10000);
    signal.throwIfAborted();
    const workspace = await fs.realpath(path.resolve(input.workspace));
    const allowed = await Promise.all((input.allowlist ?? []).map((entry) => fs.realpath(path.resolve(entry))));
    if (allowed.length && !allowed.includes(workspace))
        throw new Error(`Workspace is not allowlisted: ${workspace}`);
    const args = [
        "--no-follow",
        ...EXCLUDES.flatMap((glob) => ["--glob", `!${glob}`]),
    ];
    try {
        await fs.access(path.join(workspace, ".gitignore"));
        args.push("--ignore-file", path.join(workspace, ".gitignore"));
    }
    catch (error) {
        if (error.code !== "ENOENT")
            throw error;
    }
    async function rg(extra) {
        signal.throwIfAborted();
        try {
            const result = await runFile("rg", [...extra, ...args, "--", workspace], {
                encoding: "utf8",
                maxBuffer: 4 * 1024 * 1024,
                timeout: 2000,
                signal,
            });
            return result.stdout;
        }
        catch (error) {
            signal.throwIfAborted();
            if (error.code === 1)
                return "";
            throw error;
        }
    }
    let scannedFiles = 0;
    let scannedBytes = 0;
    async function readCandidate(file) {
        signal.throwIfAborted();
        const absolute = path.resolve(workspace, file);
        const relative = path.relative(workspace, absolute);
        if (relative === ".." ||
            relative.startsWith(`..${path.sep}`) ||
            path.isAbsolute(relative))
            return null;
        let handle;
        try {
            // Reject symlinks in every component, and protect the final open against symlink substitution.
            let cursor = workspace;
            for (const component of relative.split(path.sep)) {
                cursor = path.join(cursor, component);
                if ((await fs.lstat(cursor)).isSymbolicLink())
                    return null;
            }
            if ((await fs.realpath(absolute)) !== absolute)
                return null;
            handle = await fs.open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
            const stat = await handle.stat();
            if (!stat.isFile() || stat.size > limits.maxFileBytes)
                return null;
            if (++scannedFiles > limits.maxScanFiles ||
                (scannedBytes += stat.size) > limits.maxScanBytes) {
                throw new Error("Repository scan limit exceeded; narrow the query or workspace");
            }
            // A growing file cannot cause an unbounded read. Hash and excerpt use the same snapshot.
            const bytes = Buffer.alloc(stat.size + 1);
            let length = 0;
            while (length < bytes.length) {
                signal.throwIfAborted();
                const read = await handle.read(bytes, length, bytes.length - length, length);
                if (!read.bytesRead)
                    break;
                length += read.bytesRead;
            }
            if (length > stat.size)
                throw new Error("Repository file grew during search; retry the query");
            return { file: absolute, bytes: bytes.subarray(0, length) };
        }
        catch (error) {
            if (["ENOENT", "ELOOP", "EACCES", "ENOTDIR"].includes(error.code ?? ""))
                return null;
            throw error;
        }
        finally {
            await handle?.close();
        }
    }
    function excerpt(snapshot, line, reason) {
        const lines = snapshot.bytes.toString("utf8").split(/\r?\n/);
        const startLine = Math.max(1, line - limits.contextLines);
        const endLine = Math.min(lines.length, line + limits.contextLines);
        return {
            path: path.relative(workspace, snapshot.file),
            startLine,
            endLine,
            contentHash: sha256(snapshot.bytes),
            excerpt: lines.slice(startLine - 1, endLine).join("\n"),
            reason,
        };
    }
    const exact = await rg([
        "--json",
        "--color",
        "never",
        "--max-filesize",
        String(limits.maxFileBytes),
        "-e",
        input.query,
    ]);
    if (exact.trim()) {
        const results = [];
        for (const line of exact.split(/\r?\n/)) {
            if (!line)
                continue;
            const event = JSON.parse(line);
            if (event.type !== "match" || !event.data?.path?.text)
                continue;
            const snapshot = await readCandidate(event.data.path.text);
            if (snapshot) {
                const snapshotLines = snapshot.bytes.toString("utf8").match(/[^\n]*(?:\n|$)/g) ?? [];
                if (snapshotLines[Number(event.data.line_number) - 1] !==
                    event.data.lines?.text) {
                    throw new Error("Repository changed during search; retry the query");
                }
                results.push(excerpt(snapshot, Number(event.data.line_number), "ripgrep exact match"));
            }
            if (results.length >= limits.limit)
                break;
        }
        return results;
    }
    const terms = input.query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length)
        return [];
    const listing = await rg(["--files", "--hidden", "--null"]);
    const files = listing.split("\0").filter(Boolean).sort();
    if (files.length > limits.maxScanFiles)
        throw new Error("Repository scan limit exceeded; narrow the query or workspace");
    const results = [];
    // Four asynchronous readers at most, with a shared scan budget.
    let index = 0;
    await Promise.all(Array.from({ length: Math.min(4, files.length) }, async () => {
        while (index < files.length) {
            const snapshot = await readCandidate(files[index++]);
            if (!snapshot)
                continue;
            const content = snapshot.bytes.toString("utf8").toLowerCase();
            const score = terms.filter((term) => content.includes(term)).length;
            if (!score)
                continue;
            const line = content
                .split(/\r?\n/)
                .findIndex((line) => terms.some((term) => line.includes(term))) + 1;
            results.push({
                ...excerpt(snapshot, line, "lexical candidate"),
                score,
            });
        }
    }));
    signal.throwIfAborted();
    return results
        .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
        .slice(0, limits.limit)
        .map(({ score: _score, ...result }) => result);
}
