export declare function canonicalizeWorkspace(workspace: string): string;
export declare function assertWorkspaceAllowed(workspace: string, allowlist: string[]): string;
export declare function assertPathInsideWorkspace(workspace: string, target: string): string;
export declare function assertScopeAllowed(input: {
    workspaceId: string;
    sessionId: string;
}, allowlist: string[]): {
    workspaceId: string;
    sessionId: string;
};
