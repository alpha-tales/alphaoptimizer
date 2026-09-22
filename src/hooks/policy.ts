export const POLICY_START = "<!-- alphaoptimizer:auto-output:start -->";
export const POLICY_END = "<!-- alphaoptimizer:auto-output:end -->";
export const automaticOutputPolicy = `${POLICY_START}
## AlphaOptimizer automatic output policy

Use the connected AlphaOptimizer for eligible large tool output without requiring the user to name it.
Native PostToolUse hooks handle direct supported calls. Code-mode scripts need the following emission policy because native hook feedback does not replace values returned to JavaScript:

- Keep raw nested tool results inside the code-mode script. Before printing plain shell output or a text-only MCP result of roughly 6,000 characters or more, call the connected process_tool_result tool inside the SAME script, before any text()/notify() of the original. Discover its exact tool name/schema if needed.
- Pass hook_event_name="PostToolUse", cwd=the current authorized workspace, session_id="code-mode", a unique tool_use_id, tool_name="Bash" for exec_command (or the canonical MCP name), the original tool_input and tool_response. For exec_command, tool_response is its output string and exit_code is the actual returned exit_code (never invent a successful status). For MCP, use the complete result object so media/structured/error fields are recognized and passed through safely.
- Read structuredContent from the optimizer response, or parse its first text content block as JSON. If continue is false and stopReason is a string, print that reduced result instead of the original. Preserve available exit_code/status fields when presenting it. Otherwise print the original unchanged. Keep the raw value for any required programmatic processing.
- If the optimizer is unavailable or fails, print the original and continue; never rerun the underlying command just to optimize it. Do not use a blocking decision or alter tool execution/permissions.
- Do not recursively optimize AlphaOptimizer calls. Do not attempt to compress images, structured JSON, streaming or known sensitive output; preserve those results. Automatic processing stays local unless the separate automatic-Jev opt-in is enabled.
- The reduction is a payload estimate, not measured whole-task Codex token or billing savings. Only describe actual savings when supported by host-level measurements.
${POLICY_END}`;

export function mergeOutputPolicy(original: string, enabled: boolean): string {
  const start = original.indexOf(POLICY_START);
  const end = original.indexOf(POLICY_END);
  if (start >= 0 !== end >= 0 || (start >= 0 && end < start))
    throw new Error(
      "Incomplete AlphaOptimizer policy markers; existing instructions were not changed.",
    );
  if (start >= 0)
    return (
      original.slice(0, start) +
      (enabled ? automaticOutputPolicy : "") +
      original.slice(end + POLICY_END.length)
    );
  return enabled
    ? original +
        (original.endsWith("\n") || !original ? "\n" : "\n\n") +
        automaticOutputPolicy +
        "\n"
    : original;
}
