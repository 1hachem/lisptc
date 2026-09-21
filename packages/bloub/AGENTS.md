# @repo/bloub

The avatar component and its engine. It carries the repo's only lint and
tsconfig carve-outs, so read this file before changing how it is built.

Turbo tag: `foundation`.

## Shape

`src/BloubBot.tsx` is the component and its handle. `src/bot/` is the engine
underneath. `src/gaze.ts` holds where the avatar looks.

## Rules

**It depends on nothing.** No workspace package, React as a peer only. It ships
raw `.ts` and `.tsx` with no build step, so a consumer compiles the source.

**No path aliases.** Every import inside this package is relative. The exports
map points at raw files, and an alias would break a consumer that resolves them
directly.

**Tests sit beside the source** in `src/`, not in a `test/` directory.
`vitest.config.ts` here is what says so.

**`src/bot/skins.test.ts` does not run in CI**, and `vitest.config.ts` holds the
exclusion. It is the sweep that catches an eye escaping its silhouette, so keep
it passing locally before you push a shape or an expression.

**The carve-outs are two**: an override for `packages/bloub/**` in the root
`biome.json`, and the compiler options in the `tsconfig.json` here. They are the
whole exception. Do not copy them into another package, and do not widen them.
