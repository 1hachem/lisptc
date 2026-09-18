# @repo/ui

The base design system. **It depends on no other workspace package**, and
`pnpm check:arch` fails on any `@repo/*` in this manifest except
`@repo/tsconfigs`.

Turbo tag: `foundation`.

## Shape

`src/components/ui/` holds the shadcn primitives, one file per primitive.
`src/components/ai-elements/` holds the larger conversation and prompt-input
surfaces built on them. `src/lib/utils.ts` holds the class merger every
component uses. `src/hooks/` holds the shared hooks.

`src/styles/theme.css` holds the tokens, the palette and the shadcn variable
mapping. `src/styles/app.css` is the stylesheet that pulls it together.
`src/themes.ts` and `src/fonts.ts` name what a consumer can pick.

## Rules

A component here knows nothing about this product. It takes props and renders.
Anything that knows what a message, a workspace or a chat is belongs in
`@repo/components` or in the app.

Colors come from the tokens in `theme.css`. A hex in a component is a bug: add
the token instead, so both themes stay in step.

**Every icon comes from hugeicons.** `@hugeicons/core-free-icons` holds the data
and `@hugeicons/react` draws it. An icon is data, so it is passed as the `icon`
prop rather than rendered, and every SVG attribute goes on the drawing
component. `check:arch` fails on an import of `lucide-react`.

`components.json` still says `"iconLibrary": "lucide"`, so `shadcn add`
scaffolds lucide imports. Swap them for the hugeicons equivalent before
committing, every time.
