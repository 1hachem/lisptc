# @repo/kg-extension

Knowledge graphs. Facts with the evidence that supports them, backward rules
proved by a logic engine, forward rules run to a fixpoint, and the conflicts
between facts, all persisted one graph per stored file.

Turbo tag: `extension`.

## Shape

`src/kg.ts` is the extension and its forms, `src/kg-host.ts` the host a root
passes in, `src/ports.ts` the store port, `src/kg.ptc` the prompt and
`src/kg.memories.ptc` the built-in memories. The engine is TypeScript:
`terms.ts`, `solver.ts`, `kb.ts`, and `graph.ts`, which also reads and prints
a graph's stored text.

## Rules

Read the host-port and seam rules in `packages/interpreter/AGENTS.md`. They
govern this package.

The engine is iterative and never recurses on proof depth. A new built-in goal
goes in the solver's dispatch, not as a recursive call.

A graph's stored text is the only thing persisted. Derived facts and rules are
recomputed from it, so nothing derived is ever written to a store.

## Tests

`test/`. A test installs this extension and no other, over the in-memory store
in `test/helpers.ts`.
