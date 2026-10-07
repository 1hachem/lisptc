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

**Type sizes come from the scale in `theme.css`, and `text-sm` is the body.**
The body reads its size from that token, so a primitive scaffolded with
`text-sm` sits at body size and `text-xs` below it. Change a size there, never
by an arbitrary pixel size on a primitive, and never by restoring Tailwind's rem
defaults: those are measured from a 16px root this app does not use.

**Control, row, icon and dialog sizes come from the size tokens in
`theme.css` too.** The look is dense and exact: a control is `h-control`, a row
in a menu, list or command is `h-row`, an icon is `size-icon`, and a dialog is
capped by `max-w-dialog`, each with its `-sm`, `-xs` or `-lg` step. Padding
stays on Tailwind's 4px scale and stays tight: a surface takes `p-4` at most, a
control `px-3` at most. A size the tokens do not cover is a new token, never a
one-off on a component.

shadcn and ai-elements scaffold the roomy defaults: `h-9`, `size-4`, `p-6`,
`py-3.5`, `max-w-lg`, `font-medium` on controls. Bring a scaffolded file onto
the tokens before committing, every time, the same way its icons are swapped.
Never re-inflate a primitive from the outside with a `!` override.

**Every icon comes from hugeicons.** `@hugeicons/core-free-icons` holds the data
and `@hugeicons/react` draws it. An icon is data, so it is passed as the `icon`
prop rather than rendered, and every SVG attribute goes on the drawing
component. `check:arch` fails on an import of `lucide-react`.

`components.json` still says `"iconLibrary": "lucide"`, so `shadcn add`
scaffolds lucide imports. Swap them for the hugeicons equivalent before
committing, every time.
