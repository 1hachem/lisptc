import {
	annotate,
	type Intent,
	type IntentStep,
	intentKey,
	type Progress,
	type Question,
	questionKey,
	type Todo,
} from "@repo/interpreter/annotations";
import { topic } from "@repo/interpreter/channels";
import { effect } from "@repo/interpreter/effects";
import { EvalException } from "@repo/interpreter/errors";
import type { Interp, State, StateCodec } from "@repo/interpreter/lisp";
import {
	arrayToList,
	Cell,
	type List,
	listToArray,
	Unspecified,
} from "@repo/interpreter/objects";
import { plistOptions } from "@repo/interpreter/plist";
import { zAny, zList, zString } from "@repo/interpreter/schema";
import type { InterpExtension, SessionHooks } from "@repo/interpreter/session";
import type { Clock, PromptSource } from "@repo/shared/host";
import { z } from "zod";

export interface IntentHost {
	prompt: PromptSource;
	clock: Clock;
}

export const intended = topic<Intent>("intent");

export const asked = topic<Question>("intent-ask");

const todosCodec: StateCodec<Todo[]> = {
	toLisp: (todos) =>
		arrayToList(todos.map(({ label, done }) => new Cell(label, done || null))),
	fromLisp: (list) =>
		listToArray(list as List).map((pair) => ({
			label: (pair as Cell).car as string,
			done: (pair as Cell).cdr !== null,
		})),
};

const doingCodec: StateCodec<string | undefined> = {
	toLisp: (doing) => doing ?? null,
	fromLisp: (x) => (typeof x === "string" ? x : undefined),
};

const progressCodec: StateCodec<Progress | undefined> = {
	toLisp: (p) =>
		p === undefined
			? null
			: arrayToList([
					BigInt(p.done),
					BigInt(p.total),
					...(p.label === undefined ? [] : [p.label]),
				]),
	fromLisp: (x) => {
		if (x === null) return undefined;
		const [done, total, label] = listToArray(x as List);
		return {
			done: Number(done),
			total: Number(total),
			...(typeof label === "string" ? { label } : {}),
		};
	},
};

const logCodec: StateCodec<IntentStep[]> = {
	toLisp: (log) =>
		arrayToList(
			log.map(({ text, startedAt, ms, state, error }) =>
				arrayToList([
					text,
					BigInt(Math.trunc(startedAt)),
					ms === undefined ? null : BigInt(Math.trunc(ms)),
					state,
					...(error === undefined ? [] : [error]),
				]),
			),
		),
	fromLisp: (list) =>
		listToArray(list as List).map((entry) => {
			const [text, startedAt, ms, state, error] = listToArray(entry as List);
			return {
				text: text as string,
				startedAt: Number(startedAt),
				...(ms === null ? {} : { ms: Number(ms) }),
				state: state as IntentStep["state"],
				...(typeof error === "string" ? { error } : {}),
			};
		}),
};

type Closing = Exclude<IntentStep["state"], "running">;

function closeRunning(
	log: readonly IntentStep[],
	state: Closing,
	now: number,
	error?: string,
): IntentStep[] {
	return log.map((step) =>
		step.state === "running"
			? {
					...step,
					state,
					ms: Math.max(0, now - step.startedAt),
					error,
				}
			: step,
	);
}

interface IntentStates {
	readonly doing: State<string | undefined>;
	readonly todos: State<Todo[]>;
	readonly progress: State<Progress | undefined>;
	readonly log: State<IntentStep[]>;
}

const statesOf = new WeakMap<Interp, IntentStates>();

function shown({ doing, todos, progress, log }: IntentStates): Intent {
	const now = doing.get();
	const bar = progress.get();
	const steps = log.get();
	return {
		...(now === undefined ? {} : { doing: now }),
		todos: todos.get(),
		...(bar === undefined ? {} : { progress: bar }),
		...(steps.length === 0 ? {} : { log: steps }),
	};
}

function close(
	interp: Interp,
	state: Closing,
	clock: Clock,
	error?: string,
): Intent | undefined {
	const states = statesOf.get(interp);
	if (states === undefined) return undefined;
	const log = states.log.get();
	if (!log.some((step) => step.state === "running")) return undefined;
	states.log.set(closeRunning(log, state, clock.now(), error));
	return shown(states);
}

function count(x: unknown, what: string, least: number): number {
	if (typeof x !== "bigint")
		throw new EvalException(`integer expected as ${what}`, x);
	if (x < BigInt(least))
		throw new EvalException(`${what} must be at least ${least}`, x);
	return Number(x);
}

const seqCodec: StateCodec<number> = {
	toLisp: (n) => BigInt(n),
	fromLisp: (x) => Number(x),
};

function strings(list: List, what: string): string[] {
	return listToArray(list).map((x) => {
		if (typeof x !== "string")
			throw new EvalException(`string expected as ${what}`, x);
		return x;
	});
}

function openLabels(todos: readonly Todo[]): string {
	const open = todos.filter((t) => !t.done).map((t) => `"${t.label}"`);
	return open.length === 0 ? "none is open" : `open: ${open.join(" ")}`;
}

export function intentExtension(host: IntentHost): InterpExtension {
	const { clock } = host;
	return Object.assign(
		(interp: Interp): void => registerIntent(interp, clock),
		{
			prompt: host.prompt(),
			session(hooks: SessionHooks): void {
				let closed: Intent | undefined;
				hooks.turnStart.use((ctx, next) => {
					closed = undefined;
					statesOf.get(ctx.interp)?.log.set([]);
					return next(ctx);
				});
				hooks.stepError.use((ctx, text, next) => {
					closed =
						close(ctx.interp, "failed", clock, text.trim() || undefined) ??
						closed;
					return next(ctx, text);
				});
				hooks.beforeSettle.use(function* (ctx, more, next) {
					const decided = yield* next(ctx, more);
					if (!decided) closed = close(ctx.interp, "done", clock) ?? closed;
					return decided;
				});
				hooks.settled.use((turn, end, next) => {
					const failed = end.outcome === "failed" || end.outcome === "aborted";
					close(turn.interp, failed ? "failed" : "done", clock);
					next(turn, end);
				});
				hooks.annotate.use((buffer, into, next) => {
					const intent = closed ?? buffer.collect(intended).at(-1);
					closed = undefined;
					const question = buffer.collect(asked).at(-1);
					const withIntent =
						intent === undefined ? into : annotate(into, intentKey, intent);
					return next(
						buffer,
						question === undefined
							? withIntent
							: annotate(withIntent, questionKey, question),
					);
				});
			},
		},
	);
}

function registerIntent(interp: Interp, clock: Clock): void {
	const doing: State<string | undefined> = interp.state(
		"intent/doing",
		doingCodec,
		undefined,
		"What the agent last said it is doing now.",
	);
	const todos: State<Todo[]> = interp.state(
		"intent/todos",
		todosCodec,
		[],
		"The todo list the user sees, each label paired with t once it is done.",
	);
	const progress: State<Progress | undefined> = interp.state(
		"intent/progress",
		progressCodec,
		undefined,
		"The progress bar the user sees: steps done, steps in all, and its label.",
	);
	const log: State<IntentStep[]> = interp.state(
		"intent/log",
		logCodec,
		[],
		"Each line intent/doing gave this turn: its text, when it began in epoch ms, how long it took, and running, done or failed.",
	);
	const states: IntentStates = { doing, todos, progress, log };
	statesOf.set(interp, states);
	const seq: State<number> = interp.state(
		"intent/seq",
		seqCodec,
		0,
		"The number of the last question id handed out.",
	);

	const show = (): typeof Unspecified => {
		intended.emit(interp.channels, { user: shown(states) });
		return Unspecified;
	};

	interp.def(
		"intent/doing",
		1,
		'(intent/doing "text")',
		"Tell the user what you do now, in one short line. Replaces the line before it. Call it before slow work.",
		z.tuple([zString]),
		([text]) => {
			const now = clock.now();
			doing.set(text);
			log.set([
				...closeRunning(log.get(), "done", now),
				{ text, startedAt: now, state: "running" },
			]);
			return show();
		},
	);

	interp.def(
		"intent/todo",
		-1,
		'(intent/todo "label"...)',
		"Set the todo list the user sees, every item open. A label kept from the list before keeps its done mark.",
		z.tuple([zList]),
		([rest]) => {
			const before = todos.get();
			todos.set(
				strings(rest, "a todo label").map((label) => ({
					label,
					done: before.some((t) => t.label === label && t.done),
				})),
			);
			return show();
		},
	);

	interp.def(
		"intent/check",
		1,
		'(intent/check "label")',
		"Mark a todo done, by the label intent/todo gave it. An unknown label fails and names the open ones.",
		z.tuple([zString]),
		([label]) => {
			const now = todos.get();
			if (!now.some((t) => t.label === label))
				throw new EvalException(`no such todo; ${openLabels(now)}`, label);
			todos.set(
				now.map((t) => (t.label === label ? { label, done: true } : t)),
			);
			return show();
		},
	);

	const known = (label: string): Todo[] => {
		const now = todos.get();
		if (!now.some((t) => t.label === label))
			throw new EvalException(`no such todo; ${openLabels(now)}`, label);
		return now;
	};

	interp.def(
		"intent/drop",
		1,
		'(intent/drop "label")',
		"Remove a todo from the list the user sees, by its label. An unknown label fails and names the open ones.",
		z.tuple([zString]),
		([label]) => {
			todos.set(known(label).filter((t) => t.label !== label));
			return show();
		},
	);

	interp.def(
		"intent/move",
		2,
		'(intent/move "label" position)',
		"Move a todo to a position in the list, 0 first. A position past the end puts it last.",
		z.tuple([zString, zAny]),
		([label, rawAt]) => {
			const at = count(rawAt, "position", 0);
			const now = known(label);
			const moved = now.find((t) => t.label === label) as Todo;
			const rest = now.filter((t) => t.label !== label);
			todos.set([...rest.slice(0, at), moved, ...rest.slice(at)]);
			return show();
		},
	);

	interp.def(
		"intent/clear",
		0,
		"(intent/clear)",
		"Empty the todo list the user sees.",
		z.tuple([]),
		() => {
			todos.set([]);
			return show();
		},
	);

	interp.def(
		"intent/progress",
		-3,
		'(intent/progress done total ["label"])',
		"Show the user a progress bar: done steps of total. Call it after each step of work with a known step count.",
		z.tuple([zAny, zAny, zList]),
		([rawDone, rawTotal, rest]) => {
			const total = count(rawTotal, "total", 1);
			const done = count(rawDone, "done", 0);
			if (done > total)
				throw new EvalException(`done exceeds total ${total}`, rawDone);
			const extra = listToArray(rest);
			if (extra.length > 1)
				throw new EvalException("intent/progress takes one label", rest);
			const [label] = extra;
			if (label !== undefined && typeof label !== "string")
				throw new EvalException("string expected as the label", label);
			progress.set({
				done,
				total,
				...(label === undefined ? {} : { label }),
			});
			return show();
		},
	);

	interp.def(
		"intent/ask",
		-3,
		'(intent/ask "prompt" \'("A" "B") [:multi t])',
		"Ask the user a closed question with the choices given, one pick or several with :multi t. Ends the turn after this step: the answer arrives as the next message.",
		z.tuple([zString, zList, zList]),
		([prompt, choiceList, rest]) => {
			const choices = strings(choiceList, "a choice");
			if (choices.length === 0)
				throw new EvalException("intent/ask needs a choice", choiceList);
			const opts = plistOptions(rest, ["multi"]);
			const multi = opts.has("multi") && opts.get("multi") !== null;
			const n = seq.get() + 1;
			seq.set(n);
			asked.emit(interp.channels, {
				user: { id: `q${n}`, prompt, choices, multi },
			});
			effect.emit(interp.channels, { harness: { type: "end" } });
			return Unspecified;
		},
	);
}
