---
name: fallow
description: Codebase intelligence for TypeScript and JavaScript. Static analysis reports changed-code risk, cleanup opportunities, duplication, circular dependencies, complexity hotspots, architecture boundaries, design-system drift, feature flags, and opt-in security candidates. Optional local similar-code discovery finds functions that may implement the same intent despite different syntax. Runtime coverage can merge production execution data. Use when asked to audit PR risk, find unused code or dependencies, compare semantically similar functions, detect duplicates, inspect architecture boundaries, merge runtime coverage, auto-fix supported issues, or run fallow.
license: MIT
---
<!-- fallow:agent-install v1 skill=stub version=3.28.0 -->

# Fallow

This pointer skill was written by `fallow agent install`. The complete, version-matched skill ships inside the installed npm package:

- `node_modules/fallow/skills/fallow/SKILL.md` (start here)
- `node_modules/fallow/skills/fallow/references/` (CLI reference, MCP tools, patterns, gotchas)

Read that `SKILL.md` before running fallow. Resolve current flags from `fallow --help` and `fallow <command> --help`, never from memory.

## Fallow task map

| When the agent is about to... | Run |
|---|---|
| delete an "unused" export or file | `fallow dead-code --trace <file>:<export>` |
| prove a TypeScript symbol's exact consumers before refactoring | `fallow dead-code --type-aware --symbol-impact <file>:<export-or-class.method>` |
| find how one module reaches another | `fallow trace --path <from> <to>` (Reports `reachable: false` instead of failing when no import path exists; type-only hops are reported, not skipped.) |
| delete an "unused" dependency | `fallow dead-code --trace-dependency <name>` |
| commit or open a PR | `fallow audit --base <ref>` |
| read a diff before approving it | `fallow review --base <ref> --brief` (orientation, never gates: deterministic and always exit 0, unlike the audit row) |
| prioritize refactoring | `fallow health --hotspots --targets` |
| ask who owns code | `fallow health --ownership` |
| check untested-but-reachable code | `fallow health --coverage-gaps` |
| consolidate duplication | `fallow dupes --trace dup:<fingerprint>` |
| find feature flags | `fallow flags` |
| check which architecture rules apply to a file before changing it | `fallow guard <files>` |
| surface security candidates | `fallow security` |
| understand a finding | `fallow explain <issue-type>` |
| scope a monorepo | `--workspace <glob> / --changed-workspaces <ref>` (global flags, prefix any command) |
