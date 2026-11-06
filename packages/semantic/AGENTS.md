# @repo/semantic-extension

The `%` forms: a plain form's twin, judged by meaning instead of by value.

Turbo tag: `extension`.

## Shape

`src/semantic.ts` is the extension: it declares `SemanticHost` (the System One
model, the embedding model, the clock, its own prompt). The models' contracts
are `@repo/shared/system-one` and `@repo/shared/embedding`.
`src/semantic-host.ts` holds the host a root passes in, on `jev` and the
OpenRouter embedder from `@repo/models`. `src/semantic.ptc` is the prompt.

`check:arch` treats `src/semantic.ts` as an extension module, so it imports no
SDK, no typed env module and no node builtin.

A new System One or embedding provider belongs in `@repo/models`, not here.

## Rules

Read the host-port and seam rules in `packages/interpreter/AGENTS.md`. They
govern this package.

A `%` form exists only where its plain twin does, takes the twin's arguments,
and returns what the twin returns. A form with no twin is a base judgment
(`%p`, `%choose`, `%score`), a measure by meaning
(`%similarity`, `%cluster`, `%outliers`), or a predicate the twin cannot be.

Where the plain answer is exact, a `%` form returns it without asking the
judge. A new form keeps that fast path and a test that the judge is not called.

The judge only judges. A form that writes text belongs to `@repo/llm-extension`,
not here.

The Lisp layer is installed before the prelude, so it uses no prelude macro:
no `let`, `if`, `defun` or `defmacro`, only `cond`, `lambda`, `macro` and
helper lambdas.

## Tests

`test/`. A test hands the extension a fake `SystemOneModel` or `EmbeddingModel` rather
than calling a model.

`test/calibration/` is the exception: labelled cases run against the real
models, kept out of `pnpm test`. `task evals:semantic` runs it with the `/ai`
secrets and prints every case's score beside its label. A default threshold or
a question's wording changes only with a run that shows it, and the suite
asserts the agreement the defaults reach.
