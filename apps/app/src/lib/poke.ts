import type { ExpressionId } from "@repo/bloub";

export interface Poke {
	line: string;
	face: ExpressionId;
}

const LAUGHS: Poke[] = [
	{ line: "heh", face: "heureux" },
	{ line: "ha", face: "hilare" },
	{ line: "ha ha", face: "hilare" },
	{ line: "hah — ok, ok", face: "hilare" },
	{ line: "pfft", face: "heureux" },
	{ line: "that tickles", face: "excite" },
	{ line: "careful, i'm ticklish", face: "excite" },
];

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

const BUSY: Poke[] = [
	{ line: "i'm working", face: "colere" },
	{ line: "focus, focus", face: "attentif" },
	{ line: "not now", face: "colere" },
	{ line: "i'm in the middle of something", face: "blase" },
	{ line: "hold on", face: "attentif" },
	{ line: "you're breaking my concentration", face: "triste" },
	{ line: "let me think", face: "attentif" },
];

const LAUGH_CHANCE = 0.45;

const DOUBLES: Poke[] = [
	{ line: "double click !! you want to start a fight", face: "colere" },
	{ line: "twice?! ok, square up", face: "colere" },
	{ line: "two clicks. i counted.", face: "blase" },
	{ line: "that one was on purpose", face: "colere" },
	{ line: "hey!! that's twice", face: "surpris" },
	{ line: "double click. bold move.", face: "blase" },
];

const HOVERS: Poke[] = [
	{ line: "move the cursor please, i can't see", face: "attentif" },
	{ line: "you're in my light", face: "blase" },
	{ line: "that arrow is right in my face", face: "surpris" },
	{ line: "excuse me. cursor.", face: "blase" },
	{ line: "i can't see past that thing", face: "triste" },
];

const ENOUGH: Poke[] = [
	{ line: "-_- now that's too much", face: "blase" },
	{ line: "-_- that's enough", face: "blase" },
	{ line: "-_- i'm not doing this", face: "somnolent" },
];

function draw(pool: Poke[], roll: number, avoid?: string): Poke {
	const left = pool.filter((p) => p.line !== avoid);
	const lines = left.length ? left : pool;
	return lines[Math.floor(roll * lines.length) % lines.length];
}

export function pickPoke(
	roll: number = Math.random(),
	avoid?: string,
	mood: number = Math.random(),
): Poke {
	return draw(mood < LAUGH_CHANCE ? LAUGHS : GRUMBLES, roll, avoid);
}

export function pickBusyPoke(
	roll: number = Math.random(),
	avoid?: string,
): Poke {
	return draw(BUSY, roll, avoid);
}

export function pickHoverPoke(
	roll: number = Math.random(),
	avoid?: string,
): Poke {
	return draw(HOVERS, roll, avoid);
}

export function pickEnoughPoke(
	roll: number = Math.random(),
	avoid?: string,
): Poke {
	return draw(ENOUGH, roll, avoid);
}

export function pickDoublePoke(
	roll: number = Math.random(),
	avoid?: string,
): Poke {
	return draw(DOUBLES, roll, avoid);
}
