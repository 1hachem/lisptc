import type { ExpressionId } from "@repo/bloub";

/**
 * What the agent says when you poke its face.
 *
 * Written here for the same reason the greeting is (see `greeting.ts`): a round
 * trip to the model for this would be absurd, and the line has to land the
 * instant the click does or the joke is gone.
 *
 * A poke is a TICKLE, and that is what the two pools are about — about half the
 * time it is funny and the bot laughs, the rest of the time you have interrupted
 * it. One pool or the other every click, so the same gesture is never quite the
 * same answer twice.
 *
 * Each line comes with the face to say it with, named in the avatar's own
 * vocabulary — the same `react()` a thumbs-up goes through. So the line and the
 * expression are chosen together, which is the only way they can agree.
 *
 * The faces are all SYMMETRIC ones, and that is a rule rather than a taste:
 * `confus` and `mefiant` each carry one eye measured nearly shut, so they read as
 * a wink — the one beat this avatar does not have (see `agent-avatar.tsx`).
 *
 * Pure, with the dice as arguments, like `pickGreeting`.
 */

export interface Poke {
	line: string;
	face: ExpressionId;
}

/**
 * It tickled.
 *
 * The LAUGH is `hilare` — the engine squeezes both eyes into arcs, and it was
 * measured off the video, so the drawing is doing the laughing. That is what lets
 * the text stay dry, and dry is the voice of this app: a spelled-out giggle
 * ("hihihihi") reads as a person typing one, which is the wrong mouth. So the
 * lines are short exhales instead, and the face carries the rest.
 */
const LAUGHS: Poke[] = [
	{ line: "heh", face: "heureux" },
	{ line: "ha", face: "hilare" },
	{ line: "ha ha", face: "hilare" },
	{ line: "hah — ok, ok", face: "hilare" },
	{ line: "pfft", face: "heureux" },
	{ line: "that tickles", face: "excite" },
	{ line: "careful, i'm ticklish", face: "excite" },
];

/** It did not tickle. */
const GRUMBLES: Poke[] = [
	{ line: "stop", face: "surpris" },
	{ line: "this is embarrassing", face: "timide" },
	{ line: "not funny", face: "blase" },
	{ line: "ow", face: "triste" },
	{ line: "that's my face", face: "colere" },
	{ line: "again?", face: "blase" },
	{ line: "okay, one more", face: "somnolent" },
	{ line: "you're enjoying this", face: "fier" },
	{ line: "i'll remember this", face: "effraye" },
];

/**
 * Poked while a run is in flight, which is its own answer: the bot is mid-thought
 * and you just prodded it. Neither pool above fits — being tickled is not funny
 * when you are busy, and this is not the idle grumbling of a bot with nothing
 * else to do.
 *
 * `attentif` is the face for most of it: narrow, level eyes, the engine's
 * concentrating look. It lands while the reply streams — that state wears the
 * resting face — and not while the agent is still deciding, where `thinking` owns
 * the whole drawing and the line goes out on its own.
 */
const BUSY: Poke[] = [
	{ line: "i'm working", face: "colere" },
	{ line: "focus, focus", face: "attentif" },
	{ line: "not now", face: "colere" },
	{ line: "i'm in the middle of something", face: "blase" },
	{ line: "hold on", face: "attentif" },
	{ line: "you're breaking my concentration", face: "triste" },
	{ line: "let me think", face: "attentif" },
];

/**
 * How often a poke lands as a laugh. A little under half: the joke is that you
 * cannot tell in advance, and a bot that giggles every time is a toy where one
 * that sometimes just wants to get on with it is a character.
 */
const LAUGH_CHANCE = 0.45;

/**
 * Two pokes in one gesture. Not a draw from either pool above: a double click is
 * deliberate, so it is never funny and never merely annoying — it is a challenge,
 * and every line here answers it as one. What counts as one gesture is the
 * avatar's business, not this module's: see `DOUBLE_MS` there.
 */
const DOUBLES: Poke[] = [
	{ line: "double click !! you want to start a fight", face: "colere" },
	{ line: "twice?! ok, square up", face: "colere" },
	{ line: "two clicks. i counted.", face: "blase" },
	{ line: "that one was on purpose", face: "colere" },
	{ line: "hey!! that's twice", face: "surpris" },
	{ line: "double click. bold move.", face: "blase" },
];

/**
 * A cursor parked on the face, which from the inside of the drawing is an arrow
 * planted in the middle of its view. Nothing has been clicked — this is the bot
 * noticing it is being looked at, and it comes with the only complaint an avatar
 * whose eyes follow the pointer is entitled to.
 */
const HOVERS: Poke[] = [
	{ line: "move the cursor please, i can't see", face: "attentif" },
	{ line: "you're in my light", face: "blase" },
	{ line: "that arrow is right in my face", face: "surpris" },
	{ line: "excuse me. cursor.", face: "blase" },
	{ line: "i can't see past that thing", face: "triste" },
];

/**
 * Mashing. The last thing the bot says before it stops answering at all — the
 * avatar counts the burst and goes quiet after this one (see `BURST_LIMIT`), so
 * this is a line that has to read as the END of an exchange rather than another
 * turn in it.
 *
 * `blase` is flat horizontal slits with the gaze off to one side, and
 * `somnolent` is lids half down: the two faces the engine has that are already
 * doing `-_-`. Which is why the emoticon can stay in the text — it is the same
 * expression written twice, once in each medium, and that is the joke.
 */
const ENOUGH: Poke[] = [
	{ line: "-_- now that's too much", face: "blase" },
	{ line: "-_- that's enough", face: "blase" },
	{ line: "-_- i'm not doing this", face: "somnolent" },
];

/**
 * `avoid` is the line already on screen, and it is dropped from the draw: the
 * whole input here is mashing the same 28 pixels, and drawing the same line twice
 * in a row reads as a broken button rather than a repeated joke. A pool of one
 * would have nothing left, so it falls back to the whole of it.
 */
function draw(pool: Poke[], roll: number, avoid?: string): Poke {
	const left = pool.filter((p) => p.line !== avoid);
	const lines = left.length ? left : pool;
	// `roll` is in [0, 1) — the modulo is for the caller who hands over a 1
	return lines[Math.floor(roll * lines.length) % lines.length];
}

/** Poked once: `mood` decides whether it tickled, `roll` picks the line. */
export function pickPoke(
	roll: number = Math.random(),
	avoid?: string,
	mood: number = Math.random(),
): Poke {
	return draw(mood < LAUGH_CHANCE ? LAUGHS : GRUMBLES, roll, avoid);
}

/**
 * Poked while the agent is working. Checked before the laugh, and before the
 * grumble: whatever else a poke is, an interruption comes first.
 */
export function pickBusyPoke(
	roll: number = Math.random(),
	avoid?: string,
): Poke {
	return draw(BUSY, roll, avoid);
}

/** Not poked at all — just hovered, long enough to be rude about it. */
export function pickHoverPoke(
	roll: number = Math.random(),
	avoid?: string,
): Poke {
	return draw(HOVERS, roll, avoid);
}

/**
 * Poked past what anyone would call poking. Drawn once per burst, by an avatar
 * that then stops listening until you let go of the mouse.
 */
export function pickEnoughPoke(
	roll: number = Math.random(),
	avoid?: string,
): Poke {
	return draw(ENOUGH, roll, avoid);
}

/**
 * Poked twice in one gesture. This one outranks even `pickBusyPoke`: two clicks
 * is not an interruption you can excuse, and the bot stops being polite about it.
 */
export function pickDoublePoke(
	roll: number = Math.random(),
	avoid?: string,
): Poke {
	return draw(DOUBLES, roll, avoid);
}
