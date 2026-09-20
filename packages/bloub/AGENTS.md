# @repo/bloub

The avatar component and its engine. It carries the repo's only lint and
tsconfig carve-outs, so read this file before changing how it is built.

Turbo tag: `foundation`.

## Shape

`src/BloubBot.tsx` is the component and its handle. `src/bot/` is the engine
underneath: the frame loop, the expressions, the shapes and colors, the states
and the cycle machinery, plus the small math and geometry helpers. `src/gaze.ts`
holds where the avatar looks.

## Rules

**It depends on nothing.** No workspace package, React as a peer only. It ships
raw `.ts` and `.tsx` with no build step, so a consumer compiles the source.

**No path aliases.** Every import inside this package is relative. The exports
map points at raw files, and an alias would break a consumer that resolves them
directly.

**Tests sit beside the source** in `src/`, not in a `test/` directory. The
vitest config here includes `src/**/*.test.{ts,tsx}` and runs in a node
environment.

**`src/bot/skins.test.ts` does not run in CI.** It sweeps every shape against
every expression, which is a minute of straight compute, and starving the
runner that long makes vitest's worker RPC time out and fail the job with all
122 tests green. The config excludes it when `CI` is set, so `pnpm test` still
runs it locally and that is where an eye escaping its silhouette is caught.
Keep it passing there before you push a shape or an expression.

The root `biome.json` carries an override for `packages/bloub/**` that turns off
`noNonNullAssertion`, and the tsconfig here turns on the stricter index and
unused checks. Those two carve-outs are the whole exception. Do not copy them
into another package, and do not widen them here.
