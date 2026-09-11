# The web app

`apps/app`. What follows is the part a reader of the components cannot recover
from them: the SSR boundaries, the analytics proxy, and the agent's face.

## Server-rendered, so two inputs disagree across the boundary

The greeting and the poke lines are **pure functions of a clock and a die**, both
passed in as arguments. That is what makes them testable, and it is also what
keeps callers honest about where they run: the server's clock is in the server's
timezone and the die comes up differently on each side.

So both are picked in an **effect**, not in a `useState` initialiser. The row is
`null` for the first paint, and lands a frame later, which nobody can see.

The row is nonetheless **present from the very first paint**, empty and one line
tall. Without that, nothing was rendered until the effect had run, and the avatar
— which sits a fixed line below whatever the last turn is — sat at the top of an
empty column and then jumped a line down when the greeting appeared. `1.7em` is
the shell's own line height, so the box the text lands in is exactly the box that
was already standing there.

`prefs.ts` reads its cookie on both sides for the same reason: the server sees the
request's `Cookie` header, the browser its own jar.

## The greeting is a real assistant turn

It is `messages[0]`, and it is replayed to the model with every send, so the agent
is answering a conversation it opened rather than one that starts mid-air.

It is written locally rather than by the model because a greeting costs a round
trip and a cache warm-up, and it would be the one turn in the conversation that
says nothing. It is **prose, not Lisp**, which is legal for an assistant turn: a
form-less reply is how the policy spells "finished answering", so the model reads
it as a completed turn and not as code to carry on from.

A **fixed id** is what keeps it single. `send` replays the whole list and the
server echoes it back verbatim, ids included, so from the second turn on the
greeting arrives in `stream.messages` like any other message — prepending the
local copy on top of it would show it twice.

## Chat client traps

- **`threadId` is generated up front**, not left null until the server names one:
  the API keys the persistent `AgentRepl` (and the trace) off it, so a
  conversation without one loses its interpreter state between turns.
- **`meta` is held client-side**, keyed by message id, not read off the message.
  The transcript is replayed to the server on every send and comes back carrying
  `content` alone, so a turn's numbers would vanish the moment the user asked
  anything else. A message arrives with its numbers already final — the server
  attaches them in the same `values` event that first carries it — so an id
  recorded once is never looked at again and the effect settles.
- **The sent turn is shown optimistically.** `submit` first resets the stream's
  values to `initialValues` (`{}` for a stateless transport), so without this the
  transcript blanks out until the server's opening `values` event echoes it back.
  That empty frame collapses the scroll container, which throws a reader who was
  part-way up the conversation to the top and then scrolls them back down.
- **The turn's id is named client-side** and echoed back verbatim, so the message
  shown on send and the one that comes back are the same React row.
- **Only an explicit `"pending"` counts as warming.** An unreachable API stays
  `null`: locking the composer because the server is down would strand the user
  with no way to find out why. A send surfaces the real error instead.

## The PostHog proxy

Content blockers match analytics by domain, so `posthog.com` requests made from
the browser never leave it. The browser talks to `/ingest` on our own origin and
the server forwards verbatim — nothing there understands PostHog's ingestion API,
which is what keeps it a dumb pipe that needs no updating when that API grows.

`/static/*` splits off to the assets CDN: PostHog serves its lazily loaded bundles
(session recorder, toolbar, surveys) from a different host than the one that
accepts events.

The path is the half a blocklist can still learn. Renaming it means renaming the
`server/routes/ingest/` directory and `PROXY_PATH` in `src/lib/analytics.tsx`
together.

**Headers that must not be relayed.** Hop-by-hop headers describe one connection.
`cookie` is the one that matters: a same-origin PostHog means the browser attaches
our cookies to every event, and forwarding them hands a third party whatever
session this app grows. `accept-encoding` goes too — undici negotiates and decodes
its own, so relaying the browser's invites a body labelled gzip that is not. On
the way back, `content-encoding`/`content-length` describe a body undici already
decoded, and `set-cookie` would let a third party write first-party cookies.

The real client IP is passed on (keeping any chain a load balancer built) because
PostHog derives geo from it; the user agent survives the copy and gives it
`$browser`/`$os`.

Redirects are **followed, not relayed**: a `location` pointing at posthog.com is
exactly the request the browser cannot make. Any failure answers 502 — telemetry
must never surface as an application error.

## Browser analytics

`ui_host` is set explicitly because with a proxied `api_host` posthog-js can no
longer work out which region owns the project, and every "view in PostHog" link —
the toolbar's included — would point back at the proxy path.

`defaults: "2026-05-30"` opts into the current defaults rather than the 2015 ones;
the two that matter are a pageview per history change (this is an SPA, so a route
change is the only pageview there is) and person profiles for identified users
only.

**Ambient capture is off in dev.** A local session is one person reloading the
same page, and it would land in the same project as real traffic — distorting the
pageview and bounce numbers this exists to answer. Because `defaults` turns
pageviews on, it has to be *countermanded*, not merely left unset. A vote is the
exception and initialises the client in dev to carry it: it is not ambient
analytics but a deliberate annotation on a run, and the runs most worth annotating
are the local ones.

`environment` is registered through `before_send` rather than `posthog.register`,
because the provider captures the first pageview during init, before any effect
could run.

`distinctId` is a per-browser uuid left **anonymous** on purpose: `isIdentifiedID`
on a random id mints a person profile for a person who does not exist. When there
is a real login, that is where `identify()` and `reset()` belong. Private mode or
disabled storage yields `undefined`, and traces stay anonymous, which is fine.

`tracing_headers` takes the API's **hostname only** — a value with a port in it
matches nothing.

A thumb is sent complete on the click rather than held for a sentence that may
never be typed: a rating waiting on a follow-up is a rating lost when the tab
closes. PostHog's rule for a second event under one submission id is that it must
carry every answer collected so far, so the thumb rides along with the sentence.

## The agent's face

One character with three appearances — the avatar at the foot of the transcript,
the tab icon, and whatever a line lands next to — so all three live in
`lib/agent.tsx`. The split there is between what the agent **does** (derived and
read-only: `mood`, `state`, `label` are a function of the run, so nothing can lie
about whether it is working) and what it **feels** (set by anyone, through `say`).

The avatar **stays mounted** whatever the agent is doing. The engine morphs
between states, so a change reads as one shape becoming another; mounting it per
run would replace every transition with a cut, and `thinking` is the clearest
case — the body itself becomes the middle dot.

### Selection rules that are not taste

- **One ink for every state**, so the shape alone carries the status. That rules
  out the engine's ring states (`orbit`, `comet`, `play`): they draw strokes in
  viewBox units, 6 of 316, so at 28px they come out under a pixel wide and at
  16px worse. Bodies, eyes and dots are what is left.
- **`busy` and `idle` share a state.** While the reply streams, the only thing
  that changes is where the avatar looks.
- **Every face used is symmetric.** `confus` and `mefiant` each carry one eye
  measured nearly shut (0.17 and 0.15 of the body tall against the other's 0.44
  and 0.40), so landing on one at the end of a run read as a **wink** — the one
  beat this avatar is not supposed to have.
- **`surpris` is the resting face**, not the video's own resting pose: that one is
  a pair of narrow ovals (0.19 wide against 0.41 tall) which at icon size reads as
  two slits. `surpris` is the roundest of the sixteen, 0.45 by 0.47, and has no
  roll, so the face does not sit tilted at rest.
- **`failed` takes the upright exclamation mark.** The engine ships two, and they
  are different glyphs rather than the same one at a different angle: `exclaim` is
  a bar tapering 1.76:1, held still; `alert` is a constant-width capsule leaning
  17.7°, travelling and buzzing at 2.5 Hz. Standing `alert` up would give a
  uniform bar, since its width was measured for a lean.
- **`eyeScale={1.29}`** is just under the ceiling `@repo/bloub` locks (1.3 on
  `carre`, across the gaze envelope for all sixteen expressions). `surpris` — the
  widest, and now the resting face — is what sets it: at 1.45 the two eyes meet
  and leave the silhouette.

The gaze goes through `gaze` rather than `aim` when looking up, because the engine
only steers the gaze of a state wearing the resting face, and the two are
exclusive (`follow` wins, so it is off while busy).

### Poke gestures

Counted in the component, not taken from `onDoubleClick`. A native double click
arrives **after** the two clicks that make it up, so the second click would draw a
line from the pool and have it replaced a frame later — a flicker of a line nobody
was meant to read. And `dblclick` is a pointer event, where a button on a keyboard
is worth the same as one under a mouse: two quick presses of Enter start the same
fight.

Past `BURST_LIMIT` the bot goes **silent**, and that is the feature, not a missing
one: a line for every click in a mash is a line nobody reads. The line already on
screen is dropped from every draw, so mashing reads as a repeated joke rather than
a broken button.

Hover is armed on **enter** rather than checked on a clock: only a mouse or a pen
can hover, and a touch that reports itself as one would otherwise leave the bot
complaining about a cursor nobody has.

The status label is a **text node in a live region**, not the SVG's `aria-label`:
a live region announces when its *text* changes, and an attribute changing on a
descendant image is not that. So the drawing is hidden and the state is spoken.
The muttering is likewise spoken whole in its own region while the visible copy is
hidden, because a live region announces every change and leaving the reveal in it
would read the line out one token at a time.

### The favicon

`scripts/favicon.ts` regenerates the checked-in `.svg`/`.ico` from the same
engine, so the tab icon and the avatar cannot drift apart when a silhouette is
re-measured upstream. Run `pnpm --filter app favicon` after such a change and
commit the result. It is **not** a build step: the icon is a checked-in asset, and
neither `vite build` nor a browser should need a rasteriser.

- **One render per size** rather than one big render downscaled: at 16px an eye is
  three pixels across, and reducing a 48px raster smears it into the body. 16 and
  32 are what a browser picks for a tab, 48 is Windows' pinned shortcut; bigger
  ones would only pad the file, since an `.ico` is a bundle of complete images and
  not a mipmap chain.
- **The static file fills the eyes** in the paper colour where the live component
  punches them out with a `<mask>`. Neither reason is about the drawing: a mask
  needs a rasteriser that supports one (ImageMagick's built-in renderer does not),
  and a hole would let the tab's own background through — light on a light theme —
  where the component always has the page behind it.
- **`iconHalf` is measured once, on the resting frame, and held.** The live icon
  changes state, and `thinking` shrinks the body to a 22-unit dot with its two
  other dots outside it: re-measuring per frame zoomed into that dot and cropped
  the other two off. Resting is also the widest the drawing ever gets — 92 units
  against `thinking`'s 77 and `exclaim`'s 65 — so a crop taken there clips nothing.
- **`MARGIN` is tighter than the component's frame.** The engine's viewBox is wide
  enough for the orbit and burst states to fly around the body, so the resting
  silhouette fills 57% of it; at 16px the whole glyph would come out 9 pixels
  across.
- **`lib/bot-icon.ts` imports only types from the bot package**, never values,
  which is what lets the script load it under plain `node` (the package ships
  bundler-style sources with extensionless relative imports). The script borrows
  the app's own resolver for the engine itself rather than teaching node to
  resolve them.

`components/animated-favicon.tsx` draws the live icon frame by frame onto a canvas
and swaps a `<link rel="icon">`, because no format animates a favicon on its own —
an `.ico` is a bundle of stills, and Chrome and Safari rasterise an SVG icon once
and ignore any animation inside it.

Every moving part of it sits inside a `try`: on **any** failure the static links go
back exactly as they were and it never runs again, so the worst case is the
checked-in `favicon.ico` the page already shipped with. The first frame is drawn
**before** the head is touched, so a browser that cannot do this never loses its
icon in the first place. The page's own icon links are *taken over* rather than
out-ranked — a browser picks among declared icons by its own rules, so leaving them
in place would be a bet on which one wins.

A hidden tab throttles rAF to about a frame a second, so the loop is **parked**
rather than left running; the last frame stays on the tab, and a mood arriving
meanwhile is painted by `setState`, which is the whole point of animating the icon.
`dt` is clamped for the same reason the avatar's loop clamps it: rAF is suspended
while a tab is hidden, so the first frame back would otherwise carry the whole gap.

The engine is rewound every `REWIND_AFTER` seconds because the bot package
pre-draws its blink schedule out to 900s and past the end of it the eyes never
close again; a chat tab open for a quarter of an hour is ordinary, and `reset`
re-poses on the state it is already in, which at 32px is a sub-pixel jump.

Anyone who asked for reduced motion keeps the static icon, which is complete: this
animation carries nothing the shape does not.

## One design system, two front-ends

`apps/app` and `apps/trace-viewer` are different stacks (TanStack Start on Vite,
Next's app router) and they share every visual decision through `@repo/ui`:
`styles/theme.css` holds the gruvbox palette and the shadcn token layer over it,
`styles/app.css` holds the Tailwind entry and the base rules (mono body, 13px,
no rounded corners), `themes.ts` names the default theme, and `fonts.ts` holds
the JetBrains Mono `<link>` set both documents render. Changing a colour, the
type scale or the webfont is one edit in that package.

Tailwind v4 finds classes by scanning files, and a package that ships `.tsx`
source cannot guess who imports it. So `app.css` carries an explicit `@source`
line **per app**, pointing back out of `node_modules` at each consumer's `src`.
A new front-end that imports this stylesheet renders unstyled until its line is
added there, with nothing to say why.

Each app reaches Tailwind its own way: the app through `@tailwindcss/vite`, the
trace-viewer through `@tailwindcss/postcss` in `postcss.config.mjs`, both
resolving `@import "@repo/ui/styles/app.css"` through the package's exports map.

The trace-viewer renders server components only, so it imports `@repo/ui` by
subpath (`@repo/ui/fonts.ts`, `@repo/ui/lib/utils`) rather than through the
barrel, which re-exports the `"use client"` sidebar and its radix dependencies.
