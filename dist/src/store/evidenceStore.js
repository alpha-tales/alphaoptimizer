import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { chunkText } from "../parsers/text.js";
import { sha256, shortId } from "../util/hash.js";
import { ensurePrivateDirectory } from "./privateDirectory.js";
export class EvidenceStore {
    policy;
    db;
    dataDir;
    artifactDir;
    rawBudget;
    constructor(dataDir, policy = {
        maxStoreBytes: 256 * 1024 * 1024,
        quotaPolicy: "oldest_unprotected",
    }) {
        this.policy = policy;
        if (!Number.isSafeInteger(policy.maxStoreBytes) ||
            policy.maxStoreBytes < 1024 * 1024)
            throw new Error("Invalid store quota");
        // Partition the disk budget: raw evidence, SQLite, and rollback journal reserve.
        this.rawBudget = Math.floor(policy.maxStoreBytes / 3);
        this.dataDir = dataDir;
        this.artifactDir = path.join(dataDir, "artifacts");
        ensurePrivateDirectory(this.dataDir);
        ensurePrivateDirectory(this.artifactDir);
        this.db = new Database(path.join(dataDir, "alphaoptimizer.sqlite"));
        this.db.pragma("busy_timeout = 5000");
        this.db.pragma("journal_mode = DELETE");
        const pageSize = this.db.pragma("page_size", { simple: true });
        const pages = Math.floor((this.rawBudget - 65536) / pageSize);
        const usedPages = this.db.pragma("page_count", { simple: true });
        if (usedPages > pages) {
            this.db.close();
            throw new Error("Existing database exceeds configured disk quota; increase maxStoreBytes");
        }
        this.db.pragma(`max_page_count = ${pages}`);
        this.db.pragma("foreign_keys = ON");
        try {
            this.migrate();
            this.cleanupExpired();
            this.db
                .transaction(() => {
                const bytes = fs
                    .readdirSync(this.artifactDir)
                    .reduce((total, name) => total + fs.statSync(path.join(this.artifactDir, name)).size, 0);
                if (bytes > this.rawBudget)
                    throw new Error("Existing raw files exceed configured disk quota; increase maxStoreBytes");
            })
                .immediate();
        }
        catch (error) {
            this.db.close();
            throw error;
        }
    }
    close() {
        this.db.close();
    }
    migrate() {
        this.db.exec(`
      create table if not exists artifacts (
        artifact_id text primary key,
        workspace_id text not null,
        session_id text not null,
        tool_call_id text not null,
        content_hash text not null,
        byte_length integer not null,
        encoding text not null,
        capture_source text not null,
        capture_completeness text not null,
        privacy_class text not null,
        truncation_flag integer not null,
        created_at text not null,
        expires_at text
      );
      create table if not exists artifact_leases (
        lease_id text primary key,
        artifact_id text not null references artifacts(artifact_id) on delete cascade,
        expires_at integer not null
      );
      create index if not exists artifact_leases_artifact on artifact_leases(artifact_id, expires_at);
      create table if not exists events (
        event_id text primary key,
        artifact_id text not null references artifacts(artifact_id) on delete cascade,
        workspace_id text not null,
        session_id text not null,
        tool_call_id text not null,
        tool_name text not null,
        input_hash text not null,
        status text not null,
        exit_code integer,
        response_type text not null,
        created_at text not null
      );
      create table if not exists chunks (
        chunk_id text primary key,
        artifact_id text not null references artifacts(artifact_id) on delete cascade,
        start_byte integer not null,
        end_byte integer not null,
        start_line integer not null,
        end_line integer not null,
        parser_kind text not null,
        source_path text,
        source_hash text,
        pinned_evidence integer not null,
        text text not null
      );
      create virtual table if not exists chunks_fts using fts5(
        text,
        chunk_id unindexed,
        artifact_id unindexed
      );
      create table if not exists criteria (
        criterion_id text primary key,
        workspace_id text not null,
        session_id text not null,
        text text not null,
        provenance text not null,
        status text not null,
        evidence_refs text not null,
        observed_revision text,
        unresolved_question text,
        created_at text not null,
        updated_at text not null
      );
    `);
    }
    recoverArtifactFiles() {
        // Called only under an immediate transaction. Metadata decides whether to restore or remove.
        for (const name of fs.readdirSync(this.artifactDir)) {
            const match = /^([a-f0-9]{24})\.txt(?:\.(evict|\d+\.tmp))?$/.exec(name);
            if (!match)
                continue;
            const exists = this.db
                .prepare("select 1 from artifacts where artifact_id = ?")
                .get(match[1]);
            const file = path.join(this.artifactDir, name);
            if (match[2] === "evict" && exists)
                fs.renameSync(file, this.artifactPath(match[1]));
            else if (!exists || match[2])
                fs.rmSync(file, { force: true });
        }
    }
    cleanupExpired(now = new Date().toISOString()) {
        try {
            return this.db
                .transaction(() => {
                this.recoverArtifactFiles();
                this.db
                    .prepare("delete from artifact_leases where expires_at <= ?")
                    .run(Date.now());
                const expired = this.db
                    .prepare("select artifact_id from artifacts a where expires_at is not null and expires_at <= ? and not exists (select 1 from artifact_leases l where l.artifact_id = a.artifact_id and l.expires_at > ?)")
                    .all(now, Date.now());
                for (const row of expired) {
                    const original = this.artifactPath(row.artifact_id);
                    if (fs.existsSync(original))
                        fs.renameSync(original, `${original}.evict`);
                    this.db
                        .prepare("delete from chunks_fts where artifact_id = ?")
                        .run(row.artifact_id);
                    this.db
                        .prepare("delete from artifacts where artifact_id = ?")
                        .run(row.artifact_id);
                }
                return expired.length;
            })
                .immediate();
        }
        finally {
            // A separate lock sees committed/rolled-back state and cannot race another writer.
            this.db.transaction(() => this.recoverArtifactFiles()).immediate();
        }
    }
    /** The write lock covers quota admission, metadata, and chunk indexing across processes. */
    captureObservation(observation, options) {
        this.cleanupExpired();
        let result;
        try {
            result = this.db
                .transaction(() => {
                const id = shortId(observation.workspaceId, observation.sessionId, observation.toolCallId, sha256(observation.content ?? ""));
                if (!this.getArtifact(id)) {
                    const incoming = Buffer.byteLength(observation.content ?? "");
                    if (incoming > Math.floor(this.rawBudget / 4))
                        throw new Error("Artifact exceeds aggregate raw evidence quota");
                    const rows = this.db
                        .prepare(`select a.artifact_id, a.byte_length,
            exists(select 1 from chunks c where c.artifact_id = a.artifact_id and c.pinned_evidence = 1) or exists(select 1 from artifact_leases l where l.artifact_id = a.artifact_id and l.expires_at > ?) as pinned
            from artifacts a order by created_at, artifact_id`)
                        .all(Date.now());
                    const refs = new Set();
                    for (const row of this.db
                        .prepare("select evidence_refs from criteria")
                        .all()) {
                        for (const ref of JSON.parse(row.evidence_refs))
                            refs.add(ref);
                    }
                    for (const row of this.db
                        .prepare("select artifact_id, chunk_id from chunks")
                        .all()) {
                        if (refs.has(row.chunk_id))
                            refs.add(row.artifact_id);
                    }
                    let used = rows.reduce((total, row) => total + row.byte_length, 0);
                    const evict = rows.filter((row) => !row.pinned && !refs.has(row.artifact_id));
                    if (used + incoming > Math.floor(this.rawBudget / 4) &&
                        (this.policy.quotaPolicy === "reject" ||
                            used -
                                evict.reduce((sum, row) => sum + row.byte_length, 0) +
                                incoming >
                                Math.floor(this.rawBudget / 4))) {
                        throw new Error("Store quota reached; protected evidence retained");
                    }
                    for (const row of evict) {
                        if (used + incoming <= Math.floor(this.rawBudget / 4))
                            break;
                        const original = this.artifactPath(row.artifact_id);
                        const quarantine = `${original}.evict`;
                        fs.renameSync(original, quarantine);
                        this.db
                            .prepare("delete from chunks_fts where artifact_id = ?")
                            .run(row.artifact_id);
                        this.db
                            .prepare("delete from artifacts where artifact_id = ?")
                            .run(row.artifact_id);
                        used -= row.byte_length;
                    }
                    // Quarantined bytes remain on disk until commit. Reject if there is insufficient headroom.
                    const diskBytes = fs
                        .readdirSync(this.artifactDir)
                        .reduce((sum, name) => sum + fs.statSync(path.join(this.artifactDir, name)).size, 0);
                    if (diskBytes + incoming > this.rawBudget) {
                        throw new Error("Insufficient transactional disk headroom; increase maxStoreBytes or remove expired evidence");
                    }
                }
                const artifact = this.captureObservationLocked(observation, options);
                this.replaceChunks(artifact.artifactId, chunkText(artifact.artifactId, observation.content ?? ""));
                if (options.leaseId)
                    this.db
                        .prepare("insert into artifact_leases values (?, ?, ?) on conflict(lease_id) do update set expires_at = excluded.expires_at")
                        .run(options.leaseId, artifact.artifactId, Date.now() + 300000);
                return artifact;
            })
                .immediate();
        }
        catch (error) {
            try {
                this.db.transaction(() => this.recoverArtifactFiles()).immediate();
            }
            catch {
                /* Next sweep retries recovery. */
            }
            throw error;
        }
        try {
            this.db.transaction(() => this.recoverArtifactFiles()).immediate();
        }
        catch {
            /* Committed capture remains valid; next sweep retries deletion. */
        }
        return result;
    }
    retainResponseLease(leaseId, artifactId) {
        return this.db
            .transaction(() => {
            const updated = this.db
                .prepare("update artifact_leases set expires_at = ? where lease_id = ? and artifact_id = ?")
                .run(Date.now() + 300000, leaseId, artifactId);
            return updated.changes === 1 && this.getArtifact(artifactId) !== null;
        })
            .immediate();
    }
    captureObservationLocked(observation, options) {
        const createdAt = new Date().toISOString();
        const content = observation.content ?? "";
        const contentHash = sha256(content);
        const artifactId = shortId(observation.workspaceId, observation.sessionId, observation.toolCallId, contentHash);
        const eventId = shortId("event", observation.workspaceId, observation.sessionId, observation.toolCallId);
        const artifactPath = this.artifactPath(artifactId);
        const existingEvent = this.db
            .prepare("select artifact_id from events where event_id = ?")
            .get(eventId);
        if (existingEvent && existingEvent.artifact_id !== artifactId) {
            throw new Error(`Conflicting replay for event ${eventId}`);
        }
        const existingArtifact = this.getArtifact(artifactId);
        if (existingArtifact)
            return existingArtifact;
        if (!fs.existsSync(artifactPath)) {
            const tmpPath = `${artifactPath}.${process.pid}.tmp`;
            fs.writeFileSync(tmpPath, content, { mode: 0o600 });
            fs.renameSync(tmpPath, artifactPath);
        }
        const artifact = {
            artifactId,
            workspaceId: observation.workspaceId,
            sessionId: observation.sessionId,
            toolCallId: observation.toolCallId,
            contentHash,
            byteLength: Buffer.byteLength(content),
            encoding: "utf8",
            captureSource: options.captureSource,
            captureCompleteness: observation.captureCompleteness,
            privacyClass: observation.privacyClass,
            truncationFlag: observation.captureCompleteness !== "complete",
            createdAt,
            expiresAt: options.expiresAt ?? null,
        };
        const tx = this.db.transaction(() => {
            this.db
                .prepare(`
        insert or ignore into artifacts (
          artifact_id, workspace_id, session_id, tool_call_id, content_hash,
          byte_length, encoding, capture_source, capture_completeness,
          privacy_class, truncation_flag, created_at, expires_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
                .run(artifact.artifactId, artifact.workspaceId, artifact.sessionId, artifact.toolCallId, artifact.contentHash, artifact.byteLength, artifact.encoding, artifact.captureSource, artifact.captureCompleteness, artifact.privacyClass, artifact.truncationFlag ? 1 : 0, artifact.createdAt, artifact.expiresAt);
            this.db
                .prepare(`
        insert or ignore into events (
          event_id, artifact_id, workspace_id, session_id, tool_call_id, tool_name,
          input_hash, status, exit_code, response_type, created_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
                .run(eventId, artifact.artifactId, observation.workspaceId, observation.sessionId, observation.toolCallId, observation.toolName, observation.inputHash, observation.status, observation.exitCode ?? null, observation.responseType, createdAt);
        });
        tx();
        const stored = this.getArtifact(artifactId);
        if (!stored)
            throw new Error(`Artifact metadata was not stored: ${artifactId}`);
        return stored;
    }
    replaceChunks(artifactId, chunks) {
        const tx = this.db.transaction(() => {
            this.db
                .prepare("delete from chunks_fts where artifact_id = ?")
                .run(artifactId);
            this.db
                .prepare("delete from chunks where artifact_id = ?")
                .run(artifactId);
            const insert = this.db.prepare(`
        insert into chunks (
          chunk_id, artifact_id, start_byte, end_byte, start_line, end_line,
          parser_kind, source_path, source_hash, pinned_evidence, text
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
            const insertFts = this.db.prepare("insert into chunks_fts(text, chunk_id, artifact_id) values (?, ?, ?)");
            for (const chunk of chunks) {
                insert.run(chunk.chunkId, chunk.artifactId, chunk.startByte, chunk.endByte, chunk.startLine, chunk.endLine, chunk.parserKind, chunk.sourcePath, chunk.sourceHash, chunk.pinnedEvidence ? 1 : 0, chunk.text);
                insertFts.run(chunk.text, chunk.chunkId, chunk.artifactId);
            }
        });
        tx();
    }
    getArtifact(artifactId, scope) {
        const row = scope
            ? this.db
                .prepare("select * from artifacts where artifact_id = ? and workspace_id = ? and session_id = ?")
                .get(artifactId, scope.workspaceId, scope.sessionId)
            : this.db
                .prepare("select * from artifacts where artifact_id = ?")
                .get(artifactId);
        if (!row)
            return null;
        if (row.expires_at && Date.parse(row.expires_at) <= Date.now()) {
            throw new Error(`Artifact expired: ${artifactId}`);
        }
        return {
            artifactId: row.artifact_id,
            workspaceId: row.workspace_id,
            sessionId: row.session_id,
            toolCallId: row.tool_call_id,
            contentHash: row.content_hash,
            byteLength: row.byte_length,
            encoding: row.encoding,
            captureSource: row.capture_source,
            captureCompleteness: row.capture_completeness,
            privacyClass: row.privacy_class,
            truncationFlag: Boolean(row.truncation_flag),
            createdAt: row.created_at,
            expiresAt: row.expires_at,
        };
    }
    getChunks(artifactId, scope) {
        const artifact = this.getArtifact(artifactId, scope);
        if (!artifact)
            throw new Error(`Unknown artifact: ${artifactId}`);
        const rows = this.db
            .prepare("select * from chunks where artifact_id = ? order by start_byte")
            .all(artifactId);
        return rows.map((row) => ({
            chunkId: row.chunk_id,
            artifactId: row.artifact_id,
            startByte: row.start_byte,
            endByte: row.end_byte,
            startLine: row.start_line,
            endLine: row.end_line,
            parserKind: row.parser_kind,
            sourcePath: row.source_path,
            sourceHash: row.source_hash,
            pinnedEvidence: Boolean(row.pinned_evidence),
            text: row.text,
        }));
    }
    readArtifactRange(artifactId, startByte = 0, maxBytes = 12000, scope) {
        const artifact = this.getArtifact(artifactId, scope);
        if (!artifact)
            throw new Error(`Unknown artifact: ${artifactId}`);
        const artifactPath = this.artifactPath(artifactId);
        const stat = fs.statSync(artifactPath);
        const boundedStart = Math.max(0, Math.min(startByte, stat.size));
        const requestedEnd = Math.min(stat.size, boundedStart + maxBytes);
        const fd = fs.openSync(artifactPath, "r");
        const content = Buffer.alloc(Math.max(0, Math.min(stat.size - boundedStart, maxBytes + 4)));
        try {
            fs.readSync(fd, content, 0, content.length, boundedStart);
        }
        finally {
            fs.closeSync(fd);
        }
        if (content.length > 0 && (content[0] & 0b1100_0000) === 0b1000_0000) {
            throw new Error(`Invalid UTF-8 cursor for artifact ${artifactId}: ${boundedStart}`);
        }
        const safeLength = utf8SafePrefixLength(content, requestedEnd - boundedStart);
        if (safeLength === 0 && boundedStart < stat.size) {
            throw new Error(`maxBytes is too small to read the next UTF-8 character`);
        }
        const end = boundedStart + safeLength;
        const verifiedContent = startByte === 0 && maxBytes >= stat.size
            ? content.subarray(0, safeLength)
            : null;
        if (verifiedContent && sha256(verifiedContent) !== artifact.contentHash) {
            throw new Error(`Artifact integrity check failed: ${artifactId}`);
        }
        return {
            text: content
                .subarray(0, Math.max(0, end - boundedStart))
                .toString("utf8"),
            nextCursor: end < stat.size ? end : null,
        };
    }
    searchArtifactText(artifactId, query, maxBytes = 12000, scope, cursor) {
        const artifact = this.getArtifact(artifactId, scope);
        if (!artifact)
            throw new Error(`Unknown artifact: ${artifactId}`);
        if (!query.length ||
            query.length > 1000 ||
            !Number.isInteger(maxBytes) ||
            maxBytes < 1 ||
            maxBytes > 100000)
            throw new Error("Invalid search query or byte budget");
        // Search the authoritative UTF-8 snapshot, not independently indexed chunk text.
        const bytes = fs.readFileSync(this.artifactPath(artifactId));
        if (sha256(bytes) !== artifact.contentHash)
            throw new Error(`Artifact integrity check failed: ${artifactId}`);
        const content = bytes.toString("utf8");
        const queryHash = sha256(query);
        let charOffset = 0;
        if (cursor) {
            let state;
            try {
                state = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
            }
            catch {
                throw new Error("Invalid search cursor");
            }
            if (!state ||
                state.version !== 2 ||
                state.artifactId !== artifactId ||
                state.queryHash !== queryHash ||
                state.contentHash !== artifact.contentHash ||
                !Number.isSafeInteger(state.charOffset) ||
                state.charOffset < 0 ||
                state.charOffset > content.length) {
                throw new Error("Search cursor does not match request");
            }
            charOffset = state.charOffset;
            if (charOffset > 0 &&
                /[\uDC00-\uDFFF]/.test(content[charOffset]) &&
                /[\uD800-\uDBFF]/.test(content[charOffset - 1]))
                throw new Error("Invalid search cursor boundary");
        }
        const rows = this.getChunks(artifactId, scope);
        const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "giu");
        const chunks = [];
        const matchedRows = new Set();
        let used = 0, coveredEnd = charOffset, nextOffset = null;
        let scannedChar = 0, scannedByte = 0, firstRow = 0;
        let match;
        // Scan once in source order. Byte accounting is incremental even when there are many hits.
        while ((match = pattern.exec(content))) {
            scannedByte += Buffer.byteLength(content.slice(scannedChar, match.index));
            const hitStart = scannedByte;
            const hitBytes = Buffer.byteLength(match[0]);
            const hitEnd = hitStart + hitBytes;
            scannedChar = match.index + match[0].length;
            scannedByte = hitEnd;
            while (firstRow < rows.length && rows[firstRow].endByte <= hitStart)
                firstRow++;
            for (let i = firstRow; i < rows.length && rows[i].startByte < hitEnd; i++)
                matchedRows.add(rows[i]);
            if (match.index < charOffset ||
                scannedChar <= coveredEnd ||
                nextOffset !== null)
                continue;
            const remaining = maxBytes - used;
            if (hitBytes > remaining || chunks.length >= 50) {
                if (!chunks.length)
                    throw new Error("Search byte budget is smaller than the matching text");
                nextOffset = match.index;
                continue;
            }
            // 1024 is a context target, never a ceiling on a valid match.
            const available = Math.min(remaining, Math.max(1024, hitBytes));
            let start = Math.max(charOffset, match.index - Math.floor((available - hitBytes) / 8));
            if (start > 0 && /[\uDC00-\uDFFF]/.test(content[start]))
                start++;
            const prefix = content.slice(start, match.index);
            const tail = boundedUtf8Prefix(content.slice(scannedChar), available - Buffer.byteLength(prefix) - hitBytes);
            const text = prefix + match[0] + tail;
            const startByte = hitStart - Buffer.byteLength(prefix);
            const endByte = startByte + Buffer.byteLength(text);
            const startLine = 1 + (content.slice(0, start).match(/\n/g)?.length ?? 0);
            const sources = rows.filter((row) => row.endByte > startByte && row.startByte < endByte);
            chunks.push({
                artifactId,
                chunkId: shortId(artifactId, "search-window", String(startByte), String(endByte)),
                startByte,
                endByte,
                startLine,
                endLine: startLine + (text.replace(/\n$/, "").match(/\n/g)?.length ?? 0),
                parserKind: "artifact-search-window",
                sourcePath: null,
                sourceHash: artifact.contentHash,
                pinnedEvidence: sources.some((row) => row.pinnedEvidence),
                text,
                partial: startByte > 0 || endByte < bytes.length,
                sourceChunkIds: sources.map((row) => row.chunkId),
            });
            used += Buffer.byteLength(text);
            coveredEnd = start + text.length;
        }
        const omittedChunks = [...matchedRows].filter((row) => !chunks.some((window) => window.startByte <= row.startByte && window.endByte >= row.endByte)).length;
        const nextCursor = nextOffset === null
            ? null
            : Buffer.from(JSON.stringify({
                version: 2,
                artifactId,
                contentHash: artifact.contentHash,
                queryHash,
                charOffset: nextOffset,
            })).toString("base64url");
        return { chunks, omittedChunks, hasMore: nextCursor !== null, nextCursor };
    }
    upsertCriterion(input) {
        const now = new Date().toISOString();
        const criterionId = shortId(input.workspaceId, input.sessionId, input.text);
        const existing = this.db
            .prepare("select * from criteria where criterion_id = ?")
            .get(criterionId);
        if (existing &&
            input.status === undefined &&
            input.evidenceRefs === undefined) {
            return criterionFromRow(existing);
        }
        const criterion = {
            criterionId,
            workspaceId: input.workspaceId,
            sessionId: input.sessionId,
            text: input.text,
            provenance: input.provenance,
            status: input.status ?? existing?.status ?? "unknown",
            evidenceRefs: input.evidenceRefs ??
                (existing ? JSON.parse(existing.evidence_refs) : []),
            observedRevision: input.observedRevision ?? existing?.observed_revision ?? null,
            unresolvedQuestion: input.unresolvedQuestion ?? existing?.unresolved_question ?? null,
            createdAt: existing?.created_at ?? now,
            updatedAt: now,
        };
        this.db
            .prepare(`
      insert into criteria (
        criterion_id, workspace_id, session_id, text, provenance, status,
        evidence_refs, observed_revision, unresolved_question, created_at, updated_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      on conflict(criterion_id) do update set
        status = excluded.status,
        evidence_refs = excluded.evidence_refs,
        observed_revision = excluded.observed_revision,
        unresolved_question = excluded.unresolved_question,
        updated_at = excluded.updated_at
    `)
            .run(criterion.criterionId, criterion.workspaceId, criterion.sessionId, criterion.text, criterion.provenance, criterion.status, JSON.stringify(criterion.evidenceRefs), criterion.observedRevision, criterion.unresolvedQuestion, criterion.createdAt, criterion.updatedAt);
        return criterion;
    }
    listCriteria(workspaceId, sessionId) {
        const rows = this.db
            .prepare(`
      select * from criteria where workspace_id = ? and session_id = ? order by created_at
    `)
            .all(workspaceId, sessionId);
        return rows.map(criterionFromRow);
    }
    artifactPath(artifactId) {
        return path.join(this.artifactDir, `${artifactId}.txt`);
    }
}
function criterionFromRow(row) {
    return {
        criterionId: row.criterion_id,
        workspaceId: row.workspace_id,
        sessionId: row.session_id,
        text: row.text,
        provenance: row.provenance,
        status: row.status,
        evidenceRefs: JSON.parse(row.evidence_refs),
        observedRevision: row.observed_revision,
        unresolvedQuestion: row.unresolved_question,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}
function utf8SafePrefixLength(buffer, requestedLength) {
    const initial = Math.min(requestedLength, buffer.length);
    for (let length = initial; length <= buffer.length; length += 1) {
        try {
            new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(buffer.subarray(0, length));
            return length;
        }
        catch {
            // Try a longer prefix first so small pages can complete a multibyte character.
        }
    }
    for (let length = initial - 1; length > 0; length -= 1) {
        try {
            new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(buffer.subarray(0, length));
            return length;
        }
        catch {
            // Try a shorter prefix if the extra bytes still did not complete a character.
        }
    }
    return 0;
}
function boundedUtf8Prefix(text, maxBytes) {
    if (maxBytes <= 0)
        return "";
    const buffer = Buffer.from(text);
    let length = Math.min(maxBytes, buffer.length);
    const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
    for (let backoff = 0; backoff < 4 && length > 0; backoff++, length--) {
        try {
            return decoder.decode(buffer.subarray(0, length));
        }
        catch {
            /* Trim an incomplete final character. */
        }
    }
    return "";
}
