# @repo/diagnostics-extension

What a failed call says. It adds no form and binds no name: it hooks
`failedForm` and rewrites the report a failure reaches the model as.

Turbo tag: `extension`.

## Shape

`src/diagnostics.ts` is the extension, `src/ports.ts` the host contract and the
name matcher, `src/diagnostics-host.ts` the host a root passes in,
`src/diagnostics.ptc` the prompt.

## Rules

Read the host-port and seam rules in `packages/interpreter/AGENTS.md`. They
govern this package.

It reports and never repairs. A hook here returns `reported`, so the form still
fails and the value is unchanged. Returning `skipped` from this package would
claim a failure was prose, which is another extension's meaning.

What it knows, it reads off the error and off the interpreter it is handed:
`callee`, `why`, `expected`, `given`, `at`, and `globalNames` and `docs`. It
looks nothing up in the world, so it declares no port beyond its prompt.

It is listed last at a composition root. The chain runs in registration order,
so an extension that can claim a form outright is listed first and this one
speaks only for failures nobody else explained.

Nearness is a guess, and `nearest` in `src/ports.ts` is where the guess is
written. It only ever offers a name under the same qualifier as the one that
failed, so a wrong guess stays inside the server the call named.

## Tests

`test/`. A test installs this extension and no other, and asserts on the text
the model reads rather than on the exception.
