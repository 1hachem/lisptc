# @repo/journal-catalog

The journal entries a view reads: each kind, the shape its value carries, and
the reducer that folds a run of them. An extension records against it and the
views above the seam read against it, so the two agree without naming each
other.

Turbo tag: `static`.

## Shape

One module per surface, each its own entry in `package.json` `exports`. There
is no barrel.

## Rules

This package is data. **A `static` package depends on zod or a `foundation`
package at most**, and any package or app may depend on it. The kind primitive
it builds on lives in `@repo/shared/journal`. Recording is the interpreter's.

A kind belongs here only when a reader above the seam has to understand it. A
kind that only its own extension reads stays in that extension.

A kind is added here first. The extension that records it and the view that
reads it follow.

## Tests

`test/`.
