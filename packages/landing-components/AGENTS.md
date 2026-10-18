# @repo/landing-components

The components a landing page is drawn with, one per section type of the
`@repo/landing` schema, on top of `@repo/ui`.

Turbo tag: `ui`.

## Shape

`src/landing-view.tsx` draws a whole page and scopes its theme, font and accent
to the page's own root. `src/sections.tsx` holds one component per section
type. `src/icons.ts` names the icons a page may ask for. `src/index.ts`
re-exports what the app uses.

## Rules

A component here draws a typed page and nothing else. It talks to no backend,
no store and no router. Where a call to action leads is handed in by the app,
so routing stays in the app.

Every vertical draws with these same components. A page changes its look
through the schema's layout keys and theme tokens, never through markup or CSS
of its own, so a new look is a new key in `@repo/landing` and a branch here.

Sizes, colours and type come from the `@repo/ui` tokens. A page's accent reaches
the components as the `--brand` variable, so a component reads `brand`, never a
hex.

`@repo/ui` and `@repo/landing` are the only workspace dependencies.

## Tests

Tests live beside the source in `src/`.
