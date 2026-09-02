# bloub: notes for Claude

## What this is

`@repo/bloub` is an internal package: the avatar component (`src/BloubBot.tsx`)
and the engine it draws (`src/bot/`). There is **no app here** — the demo site,
its customiser, its timeline editor, its i18n layer and its SVG/PNG/GIF/MP4
export were all removed when the project moved into this monorepo, along with
Vue. If you need one of those back, it lives in the upstream `bloub` repository;
don't rebuild it here by accident.

```bash
pnpm --filter @repo/bloub test        # vitest
pnpm --filter @repo/bloub typecheck   # tsc --noEmit
pnpm lint                             # biome, at the root — this package included
pnpm knip                             # dead code, at the root — included too
```

Style is the repository's, applied by the repository's tools: **tabs, double
quotes, semicolons**, and comments in French. `pnpm format` at the root rewrites
this package like any other — it is in `biome.json` and in `knip.json`, and it
stays there. The package once had its own style (2 spaces, single quotes, no
semicolons); nothing of that survives except the French.

Two rule carve-outs sit in `biome.json`'s `overrides`, and they are about rules,
not files — every file here is still formatted and still linted:

- `noNonNullAssertion` is off for this package. `noUncheckedIndexedAccess` is on
  in its `tsconfig.json` and nowhere else in the repo, which makes `radii[i]!` the
  way to read a slot you know is there. There are 196 of them and no fallback
  would mean anything.
- The rest is answered in place, with a `biome-ignore` carrying the reason —
  `useExhaustiveDependencies` on the four hooks that read through refs by design,
  `noArrayIndexKey` where the index IS the identity (eye 0 is the left eye).

What knip cannot see is an export used only by its own test, and `cycles.ts` holds
five in exactly that position (`parseCycles`, `uniqueName`, `nextCycleId`,
`blocksWith`, `moveBlock`) — they served the timeline editor that left with the
app.

`src/bot/profiles.ts` is generated, and the generator does not know about the
formatter: run `biome check --write` on it after regenerating (see
[docs/measurements.md](docs/measurements.md)).

## The most important rule

**The bot's numeric constants are measurements taken off the reference video, not
settings.** Gaze angles, eye sizes, radii, timings, colours: all of it comes from
frame-by-frame analysis. Don't round them, don't simplify them, don't replace them
with values that look tidier: it breaks the resemblance, which is the only
success criterion here.

The verified traps that must not be "corrected" are listed in
[docs/measurements.md](docs/measurements.md). Read it before touching a number in
`src/bot/`.

## Invariants worth knowing before editing

Details and the reasoning behind each are in [docs/](docs/):

- **`src/bot/` has no framework and no clock.** `engine.sample(t)` is a pure
  function of time. That's what makes `frozenAt`, the state board and the
  DOM-less tests work. No real-time state, no `Date.now()`, no React import. And
  **`sample()` must not mutate**: purging a stale previous state during playback
  makes the engine non-replayable (there's a dedicated test).
- **The montage holds or cuts, it never scales time** (`cycles.ts`). Hence
  `MIN_BLOCK` (0.6 s) and `StateDef.minDuration`, which is read off the state's
  `pose()` constants. Fill it in for any new narrative state.
- **All silhouettes share the same angular sampling** (`PROFILE_SAMPLES`), which is
  what makes morphing a linear interpolation of radii. A new shape must go through
  a radial profile, or `profileFromPolygon`.
- **The eyes are holes in a `<mask>`**, not white shapes on top. That's what makes
  them clip against the silhouette on their own.
- **The render frame lives in `src/bot/repere.ts`**: `RAYON` (100) and `DEMI_VIEWBOX`
  (158) define what `sample()` returns. The component is a client of the engine, not
  its definition.
- **Anything sitting "on" the body must follow its real radius**: `radiusAtAngle`
  (defined in `shape.ts`, applied by `engine.ts`) for the eyes and the notification
  pastille. A new element anchored to the outline needs the same treatment.
- **That pro-rata places the eye's centre, not the eye.** Since the margin in front of the
  edge is multiplied by the same factor, a narrow shape pushed the eye out through the mask.
  `src/bot/eyefit.ts` adds a **common offset to both eyes** — a translation, so an isometry —
  only on a customiser shape. **It is a table built at import, not a solver in the render
  loop**, and that distinction *is* the fix: seven per-frame versions all trembled, because
  everything they read (gaze drift, pointer, expression mid-morph, which edge is nearest)
  moves every frame. The engine reads the table on the **boundaries** of each morph and
  interpolates with that morph's own curve — never on the interpolated value, which has no
  identity and exists in no table. `docs/architecture.md` lists the six variants that were
  measured and rejected; don't re-try them. `skins.test.ts` locks the lot, and it sweeps
  **time as well as combinations** — one instant per combination is what let
  `capsule` + `effraye` through.
- **States declare `ArcSpec`; only the engine rasterises.** Don't call `arcRender`
  from `states.ts`.
- **A state change landing inside a fade blends from the FROZEN composite pose**
  (`setState`), not from the full pose of the state being left — the engine has one slot of
  history, and using it naively jumped 26–43 px where a spaced change moves 10–14. It
  freezes **only** when a fade is in progress: doing it always would halt the outgoing
  state's own animation for the whole fade. Spaced playback is byte-identical, and a test
  locks both halves.
- **Transitions are exponential ease-outs and the body never overshoots.** The one
  spring is the notification pop (`NOTIF_POP = 1.14`). There is deliberately no
  spring engine. A new bouncing effect belongs in the state that needs it.
- **Two sources of shapes, not to be mixed.** `profiles.ts` is generated from the
  video and drives the animated states; `skins.ts` holds the customiser's shapes,
  built analytically. A user's shape only replaces the body on `baseBody` states
  (`idle`, `wink`, `wide`, `notify`, `swirl`); elsewhere the silhouette IS the
  animation.
- **Among catalogue states only `idle` carries `baseFace: true`** (`swirl` does too,
  but it isn't in the catalogue). The other face states have an expression measured
  off the video. That's the point.
- **A tilt is only visible on an elongated eye.** `expressions.test.ts` enforces it:
  width/height outside `[0.6, 1.7]` for a tilt of 20°+, outside `[0.8, 1.25]` below.
  Already went wrong once.
- **The catalogues carry ids, never labels.** Their ids are literal unions, and the
  consuming app resolves them to text — the package ships no translation layer, and
  `ariaLabel` is a prop for the same reason.
- **One state isn't measured: `swirl`**, an entry transition. It's deliberately outside
  `SEQUENCE` (a test locks that) and carries both `baseBody` and `baseFace`.
- **A gaze driven from outside — `follow`/`aim`, or a `gaze` script — leaves the
  envelope `eyefit` solved for**, which only covers the resting drift. On a
  customiser shape it can push an eye out through the mask: 30 units of radius on
  `capsule` + `effraye` at 26° of pitch. `skins.test.ts` locks the three shapes
  where no expression overflows in a wide envelope — `cercle`, `squircle`,
  `carre` — and the other six are the host's to measure. Don't widen that list
  without the measurement. **`eyeScale` eats the same margin**, from the other
  side: it grows the capsule in place, so the ceiling is 1.3 on `carre` in that
  envelope, and at 1.45 the two eyes meet and leave the body. Both numbers are
  tests, not prose.
- **`Look` aims in ABSOLUTE terms on both axes, and the engine does the mixing**:
  only it knows the pose at instant t. `mix` and `wander` are distinct, and drift is
  added *after* the mix. **`setLook` refuses a non-finite target**: the engine keeps
  the last one, so a single `NaN` would settle in forever.

## The React component

`BloubBot.tsx` is a port of a Vue component, and three of its rules come from that:

- **The rAF loop is mounted once and reads its props through the `p` ref.** Its
  closures are those of the first render; a prop read directly would be frozen at
  that render's value for the life of the instance. The watchers below it, on the
  other hand, read props directly — those are their own render's.
- **`useWatch` compares its deps by hand** even though React already does. Strict
  mode remounts every component in development, which replays each effect with
  identical deps: a plain "first run" flag would let every watcher fire at once, at
  instant 0, which is exactly where the engine's blend ratios are degenerate.
- **Mask and gradient ids come from `useId`, not `Math.random`.** They must be
  unique per instance (several bots share a page) and stable between server and
  client. React's decorative characters don't survive a `url(#...)`, hence the
  filtering.

`state`, `block` and `playing` were `v-model`s; they are now plain props with
`onStateChange` / `onBlockChange` / `onElapsedChange` beside them. The cursor is
held internally, so a controlled parent that echoes `block` back finds it already
applied and does nothing — that guard is what replaces the old pending-offset
dance, and removing it puts the playhead back to the start of the block on every
`seek`.

**No path aliases.** The package ships raw `.ts`/`.tsx`, so an `@/` import would
only resolve if every consumer replicated the alias. Relative imports only.

## Tests

`pnpm test` runs in `node` by default. **One file asks for a DOM** and says so on its
first line (`// @vitest-environment happy-dom`): `BloubBot.test.tsx`, which mounts the
component to check that it renders the engine's own frame rather than a second drawing
built beside it — nothing in `src/bot/` goes through the rendering path, so nothing else
can catch that. Keep the DOM per-file: a global DOM environment would slow the whole
suite for one test.

## Generated files

`src/bot/profiles.ts` is produced by `tools/extract-profiles.py` from the video's
frames (see [docs/measurements.md](docs/measurements.md)). Don't edit it by hand;
regenerate it.

## Where to read more

| | |
|---|---|
| [docs/architecture.md](docs/architecture.md) | The engine, morphing, mask eyes, `Look` |
| [docs/measurements.md](docs/measurements.md) | What was measured, the traps, regenerating `profiles.ts` |

The README is for someone arriving at the package: what it is and the component's
API. Don't duplicate it here.
