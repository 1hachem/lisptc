# @repo/prose-extension

The prose the model writes around its forms. A reply arrives as text and forms
mixed together, and this extension is what decides which is which, so the
evaluator is handed forms and nothing else.

Turbo tag: `extension`.

## Shape

`src/prose.ts` is the extension: it hooks `readSource`, `failedForm`, `unrun`
and `answered`. `src/ports.ts` declares `ProseHost`, `ProseClassifier` and the
classification a classifier returns. `src/prose-host.ts` holds the host a root
passes in. `src/prose.ptc` is the prompt.

`ProseHost` carries the classifiers and the prompt. A classifier is a port like
any other: it is handed in, so this package decides nothing by itself about
which shapes count as prose.

## Rules

Read the host-port and seam rules in `packages/interpreter/AGENTS.md`. They
govern this package.

A new shape to read as prose is a classifier on the host, never a branch inside
the extension. What the model wrote and did not run leaves through the
annotation this extension already emits, never through an import from a layer
above.

The corpus tests are the specification of this surface. A change to what counts
as prose that no corpus case catches is a change nobody can defend later.

## Tests

`test/prose.test.ts`, `test/channels.test.ts`, `test/prose-surfaces.test.ts`,
`test/prose-corpus.test.ts`, `test/prose-skipped.test.ts` and
`test/imports.test.ts`, with `test/helpers.ts` beside them. A test installs this
extension and no other.
