import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ensurePrivateDirectory,
  extractWindowsSid,
} from "../src/store/privateDirectory.js";

describe("private data directories", () => {
  it("extracts the current Windows SID from whoami output", () => {
    expect(
      extractWindowsSid('"DESKTOP\\User","S-1-5-21-100-200-300-1001"'),
    ).toBe("S-1-5-21-100-200-300-1001");
  });

  it("hardens a Windows directory with only approved principals", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "alphaoptimizer-acl-"));
    const calls: Array<[string, string[]]> = [];

    ensurePrivateDirectory(directory, "win32", (command, args) => {
      calls.push([command, args]);
      return command === "whoami"
        ? '"DESKTOP\\User","S-1-5-21-100-200-300-1001"'
        : "";
    });

    expect(calls).toEqual([
      ["whoami", ["/user", "/fo", "csv", "/nh"]],
      [
        "icacls",
        [
          directory,
          "/inheritance:r",
          "/grant:r",
          "*S-1-5-21-100-200-300-1001:(OI)(CI)(F)",
          "/grant:r",
          "*S-1-5-18:(OI)(CI)(F)",
          "/grant:r",
          "*S-1-5-32-544:(OI)(CI)(F)",
        ],
      ],
    ]);
  });

  it("fails closed when Windows ACL hardening fails", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "alphaoptimizer-acl-"));

    expect(() =>
      ensurePrivateDirectory(directory, "win32", () => {
        throw new Error("command failed");
      }),
    ).toThrow(/could not secure/i);
  });
});
