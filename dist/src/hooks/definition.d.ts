/** Opt-in user hook; deliberately not named hooks/hooks.json in the plugin package. */
export declare const automaticHookGroup: {
    matcher: string;
    hooks: {
        type: string;
        server: string;
        tool: string;
        timeout: number;
        input: {
            hook_event_name: string;
            cwd: string;
            session_id: string;
            tool_use_id: string;
            tool_name: string;
            tool_input: string;
            tool_response: string;
        };
    }[];
};
