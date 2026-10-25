# @repo/background-extension

Background Lisp. The surface that runs a form on a REPL of its own, wakes the
agent with its value, and the watch forms that poll, retry and wait.

Turbo tag: `extension`.

## Shape

`src/background.ts` is the extension, `src/background-host.ts` the host a root
passes in, `src/background.ptc` the prompt, `src/ports.ts` the port a root
implements. `src/watch.ts` holds the watch forms and `src/backoff.ts` the
backoff arithmetic they share.

## Rules

Read the host-port and seam rules in `packages/interpreter/AGENTS.md`. They
govern this package.

This package never runs a job itself. A job is started, read, awaited and
cancelled through the jobs port, and every wait a watch form makes is that
port's sleep, never a timer of its own. The runtime owns the jobs, where they
run and what happens when they end.

A job spec is plain data that survives JSON: no closure, no live object. Never
add a field to it that a durable engine could not store.

Permissions arrive as rules text. This package checks that the text reads as
Lisp and nothing more; narrowing them against the parent is the composition
root's work, so this package names no other extension.

Never keep a job in a language global, only its id. Lisp code never sets the
ids.

## Tests

`test/`. A test installs this extension and no other. `test/helpers.ts` holds
a fake clock and an in-process jobs fake, and `test/contract.ts` is the suite
any implementation of the jobs port runs.
