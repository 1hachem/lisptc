# @repo/checks

The check extension: the DSL an eval case is written in, and the surfaces it
reads a run through. Core logic and language features only, so it depends on
nothing that runs a suite. `@repo/evals` drives a suite without naming this
extension; the app that owns the cases puts this package and a REPL in one
process.

Turbo tag: `extension`.

## Shape

`src/checks.ts` holds `Checks`, which installs the DSL forms on an interpreter.
The forms are the vocabulary a case is written in: the ones that name what
happened, the argument matchers, and the temporal combinators that say when it
had to happen. Read the form names there.

`src/trace.ts` holds `Trace`, the record a run leaves behind, its
`TraceEvent` shape, and the two ways a run is observed: an extension for the
interpreter and a wrapper around an MCP client. `src/verdict.ts` holds the
shape of what the DSL decides, declared as plain types. The schema a report is
parsed with is the same shape in `@repo/evals/report`, and the two meet in the
trace-viewer adapter, where a mismatch fails to compile. The mocked world a
case runs in is not here: it names extensions, so it lives with the cases, in
`apps/trace-viewer/evals/harness`.

`src/trace.ts` wraps an MCP client and reads a secrets store, and this package
depends on neither. It borrows both contracts as types only, which the root
`AGENTS.md` governs and each import states in place. A borrowed contract buys a
type and nothing else: a value still comes through a port or a slot, and
neither package is ever a line in `package.json`.

This package does not follow the `<name>.ts` + `<name>-host.ts` pattern. It has
no host and reaches nothing outside the process.

## Rules

A new thing a case can assert is a new form in the DSL, added beside the
existing ones. It is never a helper the case file imports, because a case is
written in the dialect and reads only what the DSL installed.

Depend on nothing that runs a suite. Anything that needs this DSL and a model
belongs in the app that owns the cases, and anything that drives or describes a
finished run belongs in `@repo/evals`.

## Tests

`test/combinators.test.ts`. What the DSL makes of another extension's notes is
tested where that extension can be named, in `apps/trace-viewer/evals/harness`.
The cases themselves live in `apps/trace-viewer/evals` and run under
`pnpm test:evals`, not `pnpm test`.
