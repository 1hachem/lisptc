# @repo/dragology

A vendored copy of the dragology library (MIT, `LICENSE` here): declarative
dragging, where a drag is a choice between states the draggable renders.
Every drag in the app goes through it, by way of the drag layer in
`@repo/components`.

Turbo tag: `ui`.

## Rules

**It is someone else's code, kept close to upstream.** It holds the core the
public entry needs and nothing else: no demos, no studio, no tests. Comments
were stripped and unused exports pruned to satisfy the repo's checks. Change
it only to fix a bug that reaches the app, and keep each change small enough
to carry to the next upstream version by hand.

**The carve-out is one override** for `packages/dragology/**` in the root
`biome.json`, turning off the lint rules the upstream style breaks. Do not
widen it, and do not copy it into another package.

**Nothing else imports it directly.** `@repo/components` is its one
dependent, and a drag anywhere else is a source or a drop spot on the drag
layer there.
