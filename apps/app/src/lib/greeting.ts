/**
 * The line the agent opens an empty transcript with.
 *
 * It is written here and not by the model: a greeting costs a round trip and a
 * cache warm-up, and it would be the one turn in the conversation that says
 * nothing. So it is local, instant, and free — and it can read the clock, which
 * the agent cannot.
 *
 * Pure, and the clock and the die are both arguments: that is what makes it
 * testable, and it is also what keeps the caller honest about WHERE it is called
 * from — the server and the browser disagree on both.
 */

/** Local hour to a part of the day. The boundaries are ordinary, not measured. */
type Moment = "morning" | "afternoon" | "evening" | "night";

function momentOf(hour: number): Moment {
	if (hour >= 5 && hour < 12) return "morning";
	if (hour < 18) return "afternoon";
	if (hour < 23) return "evening";
	return "night";
}

const LINES: Record<Moment, string[]> = {
	morning: [
		"morning, sunshine. what are we building?",
		"good morning. you bring the coffee, I'll bring the parentheses.",
		"up early. what's on the plate?",
		"morning. the REPL is warm, the day is not.",
	],
	afternoon: [
		"hello — how can I help you today?",
		"good afternoon. what are we on?",
		"afternoon. shall we make something work?",
		"hi. I've been holding this REPL for you all morning.",
	],
	evening: [
		"good evening. what are we finishing tonight?",
		"evening. one more thing before the laptop closes?",
		"good evening. small task or brave task?",
		"evening. I promise to be brief. no promises.",
	],
	night: [
		"it's late. what are we debugging?",
		"still up? so am I, technically.",
		"late shift. what's broken?",
		"nothing good gets written at this hour. let's try anyway.",
	],
};

export function pickGreeting(now: Date, roll: number = Math.random()): string {
	const lines = LINES[momentOf(now.getHours())];
	// `roll` is in [0, 1) — the modulo is there for the caller who hands over a 1
	return lines[Math.floor(roll * lines.length) % lines.length];
}
