# @repo/compaction-extension

Bounded output. The interpreter holds a whole value; this extension decides how
much of it the model is shown and what to say about the rest.

Turbo tag: `extension`.

## Shape

`src/compaction.ts` is the extension: it declares `CompactionHost`, hooks the
`evalStep`, `stepOutput` and `stepError` chains, and registers the builtins a
model calls to ask for more of a value it was only shown part of.
`src/compaction-host.ts` holds the host a root passes in. `src/compaction.ptc`
is the prompt.

`CompactionHost` declares one port, the prompt. Nothing here reaches the world
otherwise, so an outward reach added later is a new field on that interface,
never an import.

## Rules

Read the host-port and seam rules in `packages/interpreter/AGENTS.md`. They
govern this package.

What the model is shown is capped. What the interpreter holds is not, and
nothing here may narrow it: an extension that wants the whole value reads it
from the interpreter.

A budget is a measured number, so it belongs in the test that asserts it. A new
way to ask for more of a value is a builtin beside the others, never a flag on
the chain that trims.

## Tests

`test/compaction.test.ts` covers the builtins and the budget.
`test/prompt.test.ts` pins what the prompt teaches. A test installs this
extension and no other.
