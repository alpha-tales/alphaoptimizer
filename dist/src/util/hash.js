import crypto from "node:crypto";
export function sha256(input) {
    return crypto.createHash("sha256").update(input).digest("hex");
}
export function shortId(...parts) {
    const hash = crypto.createHash("sha256");
    hash.update("alphaoptimizer.shortId.v2\0");
    for (const part of parts) {
        if (part === undefined) {
            hash.update("u:0:");
            continue;
        }
        const buffer = Buffer.isBuffer(part) ? part : Buffer.from(part, "utf8");
        hash.update(`${buffer.length}:`);
        hash.update(buffer);
        hash.update("\0");
    }
    return hash.digest("hex").slice(0, 24);
}
export function estimateTokens(text) {
    return Math.ceil(text.length / 4);
}
