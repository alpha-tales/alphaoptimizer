import { execFileSync } from "node:child_process";
import fs from "node:fs";
function runWindowsCommand(command, args) {
    return execFileSync(command, args, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
    });
}
export function extractWindowsSid(output) {
    const sid = output.match(/S-1-\d+(?:-\d+)+/)?.[0];
    if (!sid)
        throw new Error("Could not identify the current Windows user");
    return sid;
}
export function ensurePrivateDirectory(directory, platform = process.platform, run = runWindowsCommand) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const stat = fs.lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink())
        throw new Error(`AlphaOptimizer data directory must be private: ${directory}`);
    if (platform === "win32") {
        try {
            const currentUserSid = extractWindowsSid(run("whoami", ["/user", "/fo", "csv", "/nh"]));
            run("icacls", [
                directory,
                "/inheritance:r",
                "/grant:r",
                `*${currentUserSid}:(OI)(CI)(F)`,
                "/grant:r",
                "*S-1-5-18:(OI)(CI)(F)",
                "/grant:r",
                "*S-1-5-32-544:(OI)(CI)(F)",
            ]);
        }
        catch {
            throw new Error(`AlphaOptimizer could not secure its Windows data directory: ${directory}`);
        }
        return;
    }
    if ((stat.mode & 0o077) !== 0)
        throw new Error(`AlphaOptimizer data directory must be private: ${directory}`);
}
