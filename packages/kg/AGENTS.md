# @repo/kg-extension

Knowledge graphs: what agents learn from documents, kept as facts they can
prove things from.

Turbo tag: `extension`.

## Rules

Read the host-port and seam rules in `packages/interpreter/AGENTS.md`. They
govern this package.

A graph reaches the world only through the store port. The prompt and the
built-in memories come in through the host as well.

A stored graph is lisptc that loads by being evaluated. Nothing here reads
stored text any other way.

Only what an agent asserted is stored. Anything the engine derives is
recomputed, never written.

Proof depth must never grow the JavaScript stack. A new built-in goal joins the
solver's dispatch.

## Tests

A test installs this extension and no other, over the store in the test
helpers.
