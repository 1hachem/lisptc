# @repo/landing-components

The components a landing page is drawn with, one per section type of the
`@repo/landing` schema, on top of `@repo/ui`.

Turbo tag: `ui`.

## Shape

`src/landing-view.tsx` is a whole page, `src/sections.tsx` one component per
section type, `src/icons.ts` the icons a page may name, and `src/index.ts` what
the app imports.

## Rules

A component here draws a typed page and nothing else. It talks to no backend,
no store and no router. Routing belongs to the app.

Every vertical draws with these same components. A page changes its look
through the schema's keys and theme tokens, never through markup or CSS of its
own, so a new look starts in `@repo/landing`.

Sizes, colours and type come from the `@repo/ui` tokens. A hex in a component
is a bug.

`@repo/ui` and `@repo/landing` are the only workspace dependencies.

## Tests

Tests live beside the source in `src/`.
