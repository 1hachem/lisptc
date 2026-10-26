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
	return lines[Math.floor(roll * lines.length) % lines.length];
}

const greeted = new Map<string, string>();

export function greetingFor(
	key: string | undefined,
	now: Date,
): { line: string; typed: boolean } {
	const known = key === undefined ? undefined : greeted.get(key);
	if (known !== undefined) return { line: known, typed: true };
	const line = pickGreeting(now);
	if (key !== undefined) greeted.set(key, line);
	return { line, typed: false };
}

export function rememberedGreeting(
	key: string | undefined,
): string | undefined {
	return key === undefined ? undefined : greeted.get(key);
}

export const GREETING_ID = "greeting";

export function isGreetingMessage(message: { id?: string }): boolean {
	return message.id === GREETING_ID;
}
