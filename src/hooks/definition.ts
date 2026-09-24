/** Shared by the bundled plugin hook and legacy standalone MCP setup. */
export const automaticHookGroup = {
  matcher: "*",
  hooks: [
    {
      type: "mcp_tool",
      server: "alphaoptimizer",
      tool: "process_tool_result",
      timeout: 5,
      input: {
        hook_event_name: "PostToolUse",
        cwd: "${cwd}",
        session_id: "${session_id}",
        tool_use_id: "${tool_use_id}",
        tool_name: "${tool_name}",
        tool_input: "${tool_input}",
        tool_response: "${tool_response}",
      },
    },
  ],
};
