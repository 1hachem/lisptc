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
trace-viewer adapter, where a mismatch fails to compile. `src/mocks.ts` builds
the mocked world a case runs in, and it is the only file here that imports an
extension.

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

`test/trace-notes.test.ts` and `test/combinators.test.ts`. The cases themselves
live in `apps/trace-viewer/evals` and run under `pnpm test:evals`, not
`pnpm test`.
