# @repo/compaction-extension

Bounded output. This package owns how much of a value the model is shown, and
nothing else in the repo decides that.

Turbo tag: `extension`.

## Shape

`src/compaction.ts` is the extension, `src/compaction-host.ts` the host a root
passes in, `src/compaction.ptc` the prompt.

## Rules

Read the host-port and seam rules in `packages/interpreter/AGENTS.md`. They
govern this package.

What the model is shown is bounded. What the interpreter holds is not, and
nothing here may narrow it.

A budget is a measured number, so it belongs in the test that asserts it and
never in a constant with prose beside it.

A new way to ask for more of a value belongs on this surface, beside the ones
already there.

## Tests

`test/`. A test installs this extension and no other.
