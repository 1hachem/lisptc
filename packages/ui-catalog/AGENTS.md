# @repo/ui-catalog

The widgets a view may hold: each tag, the props it carries on the wire, which
of them are action ids, and whether it takes children. The UI extension builds
views against it and the frontend draws them against it, so the two agree
without naming each other.

Turbo tag: `static`.

## Shape

`src/catalog.ts` is the whole package.

## Rules

This package is data. **A `static` package depends on zod or a `foundation`
package at most**, and any package or app may depend on it. It reaches nothing
at runtime, so it loads in the browser.

A widget is added here first. The extension's form and the frontend's renderer
follow it, and the frontend's typecheck fails until a renderer exists.

A prop is described as it travels, never as a form takes it. How a Lisp argument
becomes a prop is the extension's business.

## Tests

`test/`.
