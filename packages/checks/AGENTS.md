# @repo/checks

The check extension: the DSL an eval case is written in, and the surfaces it
reads a run through. Core logic and language features only, so it depends on
nothing that runs a suite. `@repo/evals` runs suites, and it depends on this
package, never the other way around.

Turbo tag: `extension`.

## Shape

`src/checks.ts` holds `Checks`, which installs the DSL forms on an interpreter.
The forms are the vocabulary a case is written in: the ones that name what
happened, the argument matchers, and the temporal combinators that say when it
had to happen. Read the form names there.

`src/trace.ts` holds `Trace`, the record a run leaves behind, its
`TraceEvent` shape, and the two ways a run is observed: an extension for the
interpreter and a wrapper around an MCP client. `src/verdict.ts` holds the
schemas a verdict and an outcome are validated against. `src/mocks.ts` builds
the mocked world a case runs in.

This package does not follow the `<name>.ts` + `<name>-host.ts` pattern. It has
no host and reaches nothing outside the process.

## Rules

A new thing a case can assert is a new form in the DSL, added beside the
existing ones. It is never a helper the case file imports, because a case is
written in the dialect and reads only what the DSL installed.

Keep the dependency edge one-way. Anything that needs a runner, a model or a
reporter belongs in `@repo/evals`.

## Tests

`test/trace-notes.test.ts` and `test/combinators.test.ts`. The cases themselves
live in `apps/trace-viewer/evals` and run under `pnpm test:evals`, not
`pnpm test`.
