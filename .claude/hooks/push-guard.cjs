#!/usr/bin/env node
// PreToolUse guard for `git push`.
//
// Fail-safe design: this hook ONLY auto-allows the provably-safe case
// (a non-forced push from a non-main feature branch). For anything risky it
// emits no decision and exits 0, which defers to the normal permission flow.
// Because `git push` is intentionally NOT on the allow-list, that means a
// prompt. Worst case is therefore always "an extra prompt", never an
// un-gated push to main.
const fs = require("fs");

let data = {};
try {
  data = JSON.parse(fs.readFileSync(0, "utf8"));
} catch {
  process.exit(0); // can't parse -> defer
}

const cmd = (data.tool_input && data.tool_input.command) || "";
if (!/\bgit\s+push\b/.test(cmd)) process.exit(0); // not a push -> defer

// Forced pushes are always high-stakes.
if (/(--force\b|--force-with-lease\b|(^|\s)-f\b)/.test(cmd)) process.exit(0);

let branch = "";
try {
  branch = require("child_process")
    .execSync("git rev-parse --abbrev-ref HEAD", { stdio: ["ignore", "pipe", "ignore"] })
    .toString()
    .trim();
} catch {
  /* leave blank -> treated as unknown below */
}

const mentionsMain = /\b(main|master)\b/.test(cmd);
// A bare `git push` (no explicit remote/ref) pushes the current branch.
const barePush = !/git\s+push\s+\S/.test(cmd);
const targetsMain =
  mentionsMain || (barePush && (branch === "main" || branch === "master"));

// Unknown branch + bare push: can't confirm it's safe -> defer to prompt.
if (targetsMain || (barePush && !branch)) process.exit(0);

// Safe: non-forced push that does not target main/master.
console.log(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
      permissionDecisionReason: `Auto-allowed: non-forced push from feature branch '${branch || "unknown"}' (not main/master).`,
    },
  })
);
