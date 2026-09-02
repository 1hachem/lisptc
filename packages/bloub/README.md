# @repo/bloub

An SVG recreation of the x.ai bot avatar: **one filled shape** that morphs between
14 states, **two eyes** punched out of it as mask holes, on a plain background. No
animation library.

An internal package: it exports the avatar component and its engine, and nothing
else. There is no app, no demo page and no export tooling here — they were dropped
when it moved into this monorepo.

## Using the component

```tsx
import { BloubBot } from '@repo/bloub'

// lecteur : il enchaine le montage par defaut, releve sur la video
<BloubBot playing follow />

// une image exacte, sans boucle d'animation
<BloubBot state="orbit" size={120} frozenAt={1.2} />
```

The playback cursor is `block`, an **index into the montage** and not a state: a
montage can play the same state twice, so the index is what says where you are.
`state` follows it, as an output — `onStateChange` announces it. Pass `frozenAt`
and the component renders one exact frame with no animation loop, which is how a
thumbnail or a state board is drawn.

Props: `size`, `shape`, `color`, `ink`, `expression`, `paper`, `eyeScale`,
`frozenAt`, `cycle`, `follow`, `aim`, `gaze`, `ariaLabel`, `state`, `block`,
`playing`, plus
`onStateChange`, `onBlockChange` and `onElapsedChange`. `ink` takes any CSS
colour — `var(--fg)` included — for a host whose theme is none of the twelve in
the catalogue. `aim` replaces the rule the pointer-following uses, and `gaze`
holds a scripted look; both aim the eyes outside what the eye-fitting table
solved for, so read the warning on `aim` before using either on a shape other
than `cercle`, `squircle` or `carre`. `eyeScale` grows the eyes in place for a
host drawing at icon size, and eats the same margin: its ceiling is measured and
locked too. A `ref` exposes `seek(index, offset)` and
`rendAt(t)` — see [src/BloubBot.tsx](src/BloubBot.tsx).

The catalogues a picker needs (`SHAPES`, `COLORS`, `EXPRESSIONS`, `STATES`) come
from the package root; they carry ids and no labels, so the display is the
consumer's to translate. The rest of the engine is reachable at
`@repo/bloub/bot/<file>.ts` — that's for writing a new silhouette, not for
showing one.

```bash
pnpm --filter @repo/bloub test        # vitest
pnpm --filter @repo/bloub typecheck   # tsc --noEmit
```

## Why the numbers look arbitrary

They're measured, not chosen. The reference video was cut at 10 fps and each state
measured off the frames: silhouettes by sub-pixel ray casting, eyes by capsule
fitting, colours and stroke widths by direct sampling.

So the constants in the code are **measurements**, and rounding them to friendlier
values breaks the resemblance, which is the only thing this package is trying to
get right. A few are counter-intuitive enough to be worth knowing before you
correct anything:

| What you'd assume | What the video shows |
|---|---|
| The eyes lean `//` | They lean `\\`, around 26° off vertical |
| The body is a squircle | It's a perfect circle, radial deviation under 0.7% |
| Transitions are springs | Exponential ease-outs; the body never overshoots |
| The comet crosses the screen | The dot stays put, the trail orbits it |
| The avatar floats at rest | It doesn't. The life is gaze drift and blinking |

[docs/measurements.md](docs/measurements.md) has the rest, including how to
regenerate the extracted profiles.

## How it's put together

`src/bot/` is framework-free and clock-free: `engine.sample(t)` is a pure function
of time. Pausing, resuming, jumping to an arbitrary date and running tests all
produce the same image, which is what makes a frozen state board and the DOM-less
test suite possible. `BloubBot.tsx` is a client of that engine, not its
definition.

| | |
|---|---|
| [docs/architecture.md](docs/architecture.md) | The engine, radial-profile morphing, eyes as mask holes |
| [docs/measurements.md](docs/measurements.md) | What was measured, and regenerating `profiles.ts` |

## License

MIT. See [LICENSE](LICENSE).

Not affiliated with, endorsed by or connected to x.ai. It recreates the visual
behaviour of their bot avatar as an exercise; "Grok" and "x.ai" belong to their
owners. The MIT licence covers the code, not the design it imitates.
