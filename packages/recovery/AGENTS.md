# @repo/recovery-extension

Recovery. How a step the check stopped is repaired by editing it rather than
rewriting it.

Turbo tag: `extension`.

## Shape

`src/recovery.ts` is the extension, `src/recovery-host.ts` the host a root
passes in, `src/recovery.ptc` the prompt. `src/edits.ts` holds the text edits,
pure functions over source with no interpreter in them.

## Rules

Read the host-port and seam rules in `packages/interpreter/AGENTS.md`. They
govern this package.

It checks nothing itself and names no checker. It wraps the `admit` chain: what
a checker below it rejects becomes `rejected`, and a step made only of edit
forms is applied to `rejected` and handed down to be checked as the step's
code. So it is listed before every extension that hooks `admit` at a
composition root, or it never sees what they reject.

An edit is strict. It fails rather than guess: a replace that matches nowhere
or more than once, a call that is not there or is there twice. A failed edit
leaves `rejected` as it was.

The surface is one builtin per edit, and each one the model types is a macro
over it, so a symbol is written bare. The macros are defined in core forms
only, because an extension installs before the prelude runs.

## Tests

`test/`. A test installs this extension and no other; the checker it wraps is a
stub written there.
