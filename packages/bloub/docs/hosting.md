# Driving the bot from a host

What a consumer of `@repo/bloub` can steer, and the rules that make each of those
knobs safe. [architecture.md](./architecture.md) is the engine;
[measurements.md](./measurements.md) is where the numbers come from. This is the
seam between them and the outside world.

## Gaze scripts

A `GazeScript` is evaluated every frame with the time elapsed since it was set, in
seconds. The script carries its own clock and can chain several movements — the
component only evaluates it and knows no durations.

**The rule that makes a script maintenance-free: it must FINISH at `mix: 0`,**
where the state's own pose commands alone. Then there is nothing to release — and
a release would show, as one last slide of the eyes at exactly the moment
everything should be settled.

`gaze` and `follow` are **exclusive**, and `follow` wins. A script is how a pose
is held on a state that is *not* wearing the resting face, where pointer-following
goes slack.

The type stays general although there is only one script today: four were written
and compared side by side before one was kept, and this shape is what let them be
tried without touching the engine.

### `SCRIPT_MORPH` is short but never zero

The script *is* the animation, so letting the engine smooth a second of its own
over the top would delay its start by a quarter second — a script that opens by
looking into the distance would have its eyes leave the pose, come back, and
leave again.

Not zero, though: at zero `lookAtTime` divides zero by zero on the frame the
target is set, and a `NaN` takes up residence in the engine for good.

### The initial value is dated one catch-up earlier

`engine.setLook(gaze(0), clock - SCRIPT_MORPH, SCRIPT_MORPH)`, so it is already
fully applied on the first frame. Without it the engine renders frame one with the
neutral gaze and frame two with the script's, and the eyes jump between them —
subtle for a script that starts at rest, spectacular for one that starts looking
away: 127 px at once on a ball of radius 100, which is exactly the defect these
scripts exist to fix.

### `TOUR`: the turn only works on a circle

The eyes are re-seated on the real outline by `radiusAtAngle`, so on a
non-circular shape they follow the profile as they go round and stutter along it.
A host that has set a customiser shape must not play this script.

It keeps `mix: 0` from beginning to end: no direction is imposed, only `spin`
fades, which sends the eyes **behind** the ball and brings them back exactly where
the chosen expression puts them. That is free on a sphere — past 90° of yaw they
cross the limb, the engine drops them from the frame, and they reappear on the
other side — so the swirl is not an effect laid on top but the same orthographic
projection pushed a full turn. And `-360°` being the same angle as `0`, it
**lands correctly by construction**, which is what separates it from a gaze pose
written into a state, where the eyes stop wherever the curve ended.

It is an ease-in-**out**, not the project's usual exponential ease-out: this is not
a value settling, it is an object turning. In ease-out two thirds of the turn were
swallowed in 0.3 s — a jolt, not a rotation.

**It is abrupt at the limb** — 20 px between two frames on a ball of radius 100 —
and that is not a tuning fault. Near the edge a small angle becomes a large screen
displacement, and the eye vanishes then reappears on the far side. Slowing it down
changes nothing; the trajectory wants this, and it is what makes the effect. Do
not try to soften it.

### `HUMEURS` is a selection rule, not a taste

Every expression in it has **zero roll**. Yaw and pitch are neutralised by
tracking because they are absolute, but roll is not: it tilts the head, so it
moves the eyes vertically, and a mood at −15° followed by one at +8° makes them
jump. What is left to tell the moods apart is the **shape** of the eyes — round,
narrowed, wide, flattened — which is plenty, and is what reads.

So adding `curieux` (roll −15°) brings the jump back.

### The chosen angles

`YAW_MAX`, `PITCH_MAX`, `PITCH`, `TURN` and `SPIN` are **chosen, not measured** —
the reference video shows no cursor tracking at all. Wide enough to be told apart
from the resting drift (±7° of yaw, ±5.5° of pitch), restrained enough that no eye
goes behind the limb. `gaze.test.ts` sweeps all sixteen expressions at the four
corners of the screen, the arrival turn included, and that margin is what it
guards: if it disappears, `YAW_MAX` or `TURN` was pushed too far.

`PITCH` is an **absolute** height, and that is the whole point. In relative terms
the eye height followed each expression's own, and since `neutre` looks at +28.6°
where the moods sit between −9 and +9, the eyes dropped all at once on the first
mood change.

`TURN_TIME` (1.1 s) is deliberately shorter than `swirl`'s block (1.3 s): the eyes
have to be settled to the left before the rings fade out.

## Playback, the cursor and frozen frames

`frozenAt` freezes time **inside the current state**; it does not walk the blocks.
`rendAt(t)` is a separate method for that reason, and `seek` would not do either:
`apply` dates the engine off the clock, which only advances in the loop and so
stays at zero when frozen — every state change would be recorded at instant 0 and
the fades at block joins would be wrong. `rendAt` therefore calls `setState` at
the block's **absolute** offset, so the engine dates the transition where it really
falls in the cycle and `sample(t)` lands on the same frame real-time playback
would have produced.

**Seeking backwards restarts with no history**, where a normal advance keeps the
state being left so it can be blended. Without that distinction, replaying frame 0
after a full pass dated the first state at instant 0 with the **last** one as its
predecessor, and rendered that one's pose: a two-pass export opened on a ball with
no eyes. With it, the player is idempotent and a pass can be replayed as often as
you like.

**Moving `frozenAt` must redraw.** The prop only ever posed a thumbnail once, so
nobody moved it; an animated export, on the other hand, steps frame by frame on an
off-screen instance. Without the watcher it stays on its first frame and the
exported animation does not move.

**A `state` prop set while stopped must not be overwritten by the montage.** The
mount does not apply `cycle[0]` in that case — it would replace the requested state
and the caller would watch the ball snap back to `idle` on mount. `nextAt` stays at
infinity until playback starts.

**The state watcher is guarded, and the guard is not an optimisation.** It
corrupted one frame at *every* block join on export: `rendAt` sets the state at its
absolute offset and samples at the right date, but the watcher then ran a
non-inert `redrawFrozen()` (an off-screen player is mounted with `frozenAt: 0`).
`sample(0)` just after a change dated at that offset gives a blend ratio of zero,
hence the **previous** state's pose — the exclamation mark jumped back to the start
of its travel for one frame, thirteen times in the default cycle.

## Pointer input

**Touch is ignored.** A finger leaves no cursor behind, so a lifted one would
freeze the gaze on the last point touched, which reads as a bug.

**The bounding rect is re-read every frame** rather than cached: the avatar slides
and grows during a view transition, and a cached centre would aim off-target for
the whole movement. Normalisation is over the **half-window**, not the avatar's
size, so the gaze saturates when the cursor reaches the screen edge whatever room
the ball occupies.

**A zero-area box returns early.** There is nothing to aim at, and the
normalisation would be `0 / 0`. The engine keeps the last target, so one `NaN` set
once stays forever and the bot never rests again. This happens for real:
`getBoundingClientRect` returns zeros while the browser pane is hidden. (The engine
refuses a non-finite target too — it should not depend on its callers being
careful.)

Gaze is only steered on states wearing the **resting face**. Elsewhere the gaze
pose IS the measured animation — `orbit` already sends the eyes round the sphere —
and layering on top would blur it.

## Storage bounds

`MAX_BLOCS` (200) and `MAX_BLOCK` (10 s) are not product limits. They are guards
against hostile storage, which is user-editable and holds a few megabytes while
nothing downstream is sized for that: one cycle of 150,000 blocks — about 4 MB of
JSON, so within budget — gives 1,500,000 s of duration, that many ticks to
allocate and a 29,700,000 px track. The tab froze on entering the Animations view.
200 blocks is half an hour of montage, far beyond any use.

The **edit** path is capped as well as the read path. A read bound that is not also
an edit bound is a trap, not a protection: the editor let a montage be built that
storage would not return on reload, and the work vanished silently.

**Truncate before validating.** Validating 150,000 blocks in order to keep 200 is
the work being avoided.

**Validate against `SEQUENCE`, not `STATE_BY_ID`.** The latter contains `swirl`,
which is deliberately outside the catalogue. A user montage is only built from the
palette, so a `swirl` can only arrive through hand-edited storage, and there is no
reason to tolerate it where it is excluded everywhere else.

An empty cycle name means "never named by the user", so the display can show it in
the current language. Writing a real name here would freeze it: it goes to
localStorage on the first visit and becomes user data that changing language no
longer retranslates.

## The render frame

`DEMI_VIEWBOX` (158) is **not a free value**. The orbit rings and the comet's
swoosh reach 1.4× the radius, i.e. 140. Nothing bounds them at runtime — it is the
hand-tuning of the `RINGS` and `SWOOSH` tables in `decor.ts` that keeps them under
158, and a test locks it.

`RAYON` (100) is chosen, not measured: it is the working unit, and everything else
in `src/bot/` is expressed as a fraction of it, which is what makes the video
measurements independent of display size.

Both live in `src/bot/repere.ts` because `src/bot/` is what is read and consumed
from outside; the component is *a* client of the engine, not its definition.
