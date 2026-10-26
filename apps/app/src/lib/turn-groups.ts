import type { ActivityEntry, Intent } from "@repo/interpreter/annotations";
import {
	type ChatMessage,
	isParentMessage,
	isSystemMessage,
	isToolMessage,
	isUserMessage,
	toolActivity,
	toolFailed,
	toolIntent,
	toolQuiet,
} from "./chat.tsx";

export interface Turn {
	id: string;
	asked?: ChatMessage;
	steps: ChatMessage[];
}

export function groupTurns(messages: readonly ChatMessage[]): Turn[] {
	const turns: Turn[] = [];
	for (const [at, message] of messages.entries()) {
		const open = turns.at(-1);
		if (isUserMessage(message) || isParentMessage(message))
			turns.push({ id: message.id ?? `turn:${at}`, asked: message, steps: [] });
		else if (open === undefined)
			turns.push({ id: `turn:${at}`, steps: [message] });
		else open.steps.push(message);
	}
	return turns;
}

export function turnMessages(turn: Turn): ChatMessage[] {
	return turn.asked === undefined ? turn.steps : [turn.asked, ...turn.steps];
}

export type TurnLink =
	| { kind: "text"; message: ChatMessage }
	| {
			kind: "call";
			call?: ChatMessage;
			result: ChatMessage;
			doing?: string;
			introduces: string[];
			progress: boolean;
	  };

function mergeIntent(
	held: Intent | undefined,
	next: Intent | undefined,
): Intent | undefined {
	if (next === undefined) return held;
	const defined = Object.fromEntries(
		Object.entries(next).filter(([, value]) => value !== undefined),
	);
	return { ...held, ...defined };
}

export interface TurnShape {
	intent?: Intent;
	activity: ActivityEntry[];
	answer?: ChatMessage;
	chain: TurnLink[];
	steps: number;
	failed: boolean;
}

export function shapeTurn(turn: Turn): TurnShape {
	const shape: TurnShape = {
		activity: [],
		chain: [],
		steps: 0,
		failed: false,
	};
	const activity = new Map<string, ActivityEntry>();
	let call: ChatMessage | undefined;
	let doing: string | undefined;
	let logged = 0;
	let progressed = false;
	for (const message of turn.steps) {
		if (isSystemMessage(message)) continue;
		if (!isToolMessage(message)) {
			shape.answer = message;
			shape.chain.push({ kind: "text", message });
			call = message;
			continue;
		}
		shape.steps += 1;
		const intent = toolIntent(message);
		const log = intent?.log ?? [];
		const introduces = [
			...log.slice(logged).map((_, at) => `intent:${logged + at}`),
			...toolActivity(message)
				.filter((entry) => !activity.has(entry.id))
				.map((entry) => `activity:${entry.id}`),
		];
		const progress: boolean = !progressed && intent?.progress !== undefined;
		if (!toolQuiet(message)) {
			shape.chain.push({
				kind: "call",
				call,
				result: message,
				...(intent?.doing !== undefined && intent.doing !== doing
					? { doing: intent.doing }
					: {}),
				introduces,
				progress,
			});
			logged = Math.max(logged, log.length);
			progressed ||= progress;
			doing = intent?.doing ?? doing;
		}
		call = undefined;
		shape.intent = mergeIntent(shape.intent, intent);
		shape.failed = toolFailed(message);
		for (const entry of toolActivity(message))
			activity.set(entry.id, { ...activity.get(entry.id), ...entry });
	}
	shape.activity = [...activity.values()];
	return shape;
}

export interface TurnTodos {
	turn: string;
	todos: NonNullable<Intent["todos"]>;
	progress?: Intent["progress"];
	last: boolean;
}

export function latestTodos(turns: readonly Turn[]): TurnTodos | undefined {
	for (let at = turns.length - 1; at >= 0; at -= 1) {
		const turn = turns[at];
		if (turn === undefined) continue;
		const { intent } = shapeTurn(turn);
		if (intent?.todos && intent.todos.length > 0)
			return {
				turn: turn.id,
				todos: intent.todos,
				progress: intent.progress,
				last: at === turns.length - 1,
			};
	}
	return undefined;
}
