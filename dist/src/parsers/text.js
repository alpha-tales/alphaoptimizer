import { shortId } from "../util/hash.js";
const FAILURE_PATTERNS = [
    /\b(error|failed|failure|exception|traceback|assert|timeout|timed out|segmentation fault)\b/i,
    /^\s*(FAIL|ERROR|✕|×)\b/i,
    /^\s*at\s+\S+/i,
];
export function chunkText(artifactId, text, parserKind = "plain-text") {
    const lineMatches = [...text.matchAll(/[^\n]*(?:\n|$)/g)]
        .map((match) => match[0])
        .filter((line, index, all) => line.length > 0 || index < all.length - 1);
    const lines = lineMatches.length > 0 ? lineMatches : [text];
    const lineStartBytes = [];
    let offset = 0;
    for (const line of lines) {
        lineStartBytes.push(offset);
        offset += Buffer.byteLength(line);
    }
    lineStartBytes.push(offset);
    const chunks = [];
    // Unknown formats retain the entire diagnostic record until an explicit boundary.
    let inDiagnostic = false;
    const pinnedLines = lines.map((line) => {
        if (/^\s*(PASS\b|✓|Test Suites:|Tests:)/.test(line) || !line.trim())
            inDiagnostic = false;
        if (FAILURE_PATTERNS.some((pattern) => pattern.test(line)) ||
            /^\s*(Expected|Received|Actual|AssertionError)\b/i.test(line))
            inDiagnostic = true;
        return inDiagnostic;
    });
    const chunkLines = Math.max(40, Math.ceil(lines.length / 4096));
    for (let i = 0; i < lines.length; i += chunkLines) {
        const sliceEnd = Math.min(lines.length, i + chunkLines);
        const slice = lines.slice(i, sliceEnd);
        const block = slice.join("");
        const startByte = lineStartBytes[i];
        const endByte = lineStartBytes[sliceEnd];
        const startLine = i + 1;
        const endLine = i + slice.length;
        chunks.push({
            artifactId,
            chunkId: shortId(artifactId, String(startLine), String(endLine), block),
            startByte,
            endByte,
            startLine,
            endLine,
            parserKind,
            sourcePath: null,
            sourceHash: null,
            pinnedEvidence: pinnedLines.slice(i, sliceEnd).some(Boolean),
            text: block,
        });
    }
    return chunks.filter((chunk) => chunk.text.length > 0);
}
