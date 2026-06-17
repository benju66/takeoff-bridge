#!/usr/bin/env node
// PreToolUse guard for the Supabase `execute_sql` MCP tool.
//
// Fail-safe design: this hook ONLY auto-allows clearly read-only SQL
// (no DDL/DML keywords). Anything containing a write/DDL keyword emits no
// decision and exits 0, deferring to the normal permission flow. Because
// `execute_sql` is intentionally NOT on the allow-list, that means a prompt.
// Worst case is therefore always "an extra prompt", never an un-gated write.
// (`apply_migration` is DDL by definition and is simply left off the
// allow-list, so it always prompts -- no hook needed.)
const fs = require("fs");

let data = {};
try {
  data = JSON.parse(fs.readFileSync(0, "utf8"));
} catch {
  process.exit(0); // can't parse -> defer
}

// The whole tool_input is searched so we catch the query under any field name.
const sql = JSON.stringify(data.tool_input || {});

// Any write/DDL keyword (word-boundaried) -> defer to prompt.
const writeKeyword =
  /\b(create|alter|drop|truncate|insert|update|delete|merge|grant|revoke|reindex|vacuum|cluster|copy)\b/i;
if (writeKeyword.test(sql)) process.exit(0);

// No write keywords detected -> treat as read-only and auto-allow.
console.log(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
      permissionDecisionReason: "Auto-allowed: read-only SQL (no DDL/DML keywords detected).",
    },
  })
);
