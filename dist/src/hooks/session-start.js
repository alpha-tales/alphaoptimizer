import { automaticOutputPolicy } from "./policy.js";
// No dependencies, user-file edits, credential reads, or network access at session start.
console.log(JSON.stringify({
    hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: automaticOutputPolicy + "\nDo not claim automatic optimization is active merely because the plugin is installed. Use optimization_status to check configuration and whether this server has received hook events. Missing Jev credentials or disabled modes mean automatic optimization is inactive.",
    },
}));
