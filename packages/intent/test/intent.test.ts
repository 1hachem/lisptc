import {
	bufferTransport,
	type ChannelBuffer,
} from "@repo/interpreter/channels-host";
import { driveSync, settled } from "@repo/interpreter/drive";
import { effect } from "@repo/interpreter/effects";
import { EvalException } from "@repo/interpreter/errors";
import { journal } from "@repo/interpreter/journal";
import { Interp, runSync } from "@repo/interpreter/lisp";
import { prelude } from "@repo/interpreter/prelude";
import { str } from "@repo/interpreter/print";
import {
	type AgentTurn,
	newSessionHooks,
	type SessionHooks,
	type TurnOutcome,
} from "@repo/interpreter/session";
import { intentKind, questionKind } from "@repo/journal-catalog/intent";
import { entriesOf } from "@repo/shared/journal";
import { describe, expect, test } from "vitest";
import { intentExtension } from "../src/intent.ts";
import { intentHost } from "../src/intent-host.ts";

function fresh() {
	const clock = { at: 1000, now: () => clock.at };
	const extension = intentExtension({ ...intentHost, clock });
	const interp = new Interp({ extensions: [extension] });
	runSync(interp, prelude);
	const hooks = newSessionHooks();
	extension.session?.(hooks);
	return { interp, hooks, clock };
}

function turnStart(interp: Interp, hooks: SessionHooks): void {
	driveSync(
		hooks.turnStart.run(() => settled(undefined), { interp, emit: () => {} }),
	);
}

function failStep(interp: Interp, hooks: SessionHooks, code: string) {
	return watching(interp, () => {
		step(interp, code);
		hooks.stepError.run(
			(_c, text) => ({ model: text, user: text }),
			{ interp, code, emit: () => {} },
			"boom\n",
		);
	});
}

function watching(interp: Interp, run: () => void) {
	const buffer = bufferTransport();
	const detach = interp.channels.pipe(buffer);
	try {
		run();
	} finally {
		detach();
	}
	return { buffer };
}

function intents(buffer: ChannelBuffer) {
	return entriesOf(buffer.collect(journal), intentKind);
}

function questions(buffer: ChannelBuffer) {
	return entriesOf(buffer.collect(journal), questionKind);
}

function settle(interp: Interp, hooks: SessionHooks, outcome: TurnOutcome) {
	const turn: AgentTurn = {
		interp,
		threadId: "t",
		turnId: "u",
		prompt: "",
		provider: "p",
		model: "m",
	};
	hooks.settled.run(() => {}, turn, {
		outcome,
		answer: "",
		steps: 1,
		latencyMs: 0,
	});
}

function beforeSettle(interp: Interp, hooks: SessionHooks, more: boolean) {
	return watching(interp, () => {
		driveSync(
			hooks.beforeSettle.run(
				(_c, m) => settled(m),
				{ interp, emit: () => {} },
				more,
			),
		);
	});
}

function logOf(interp: Interp): string {
	return str(runSync(interp, "*intent/log*"));
}

function step(interp: Interp, code: string) {
	const buffer = bufferTransport();
	const detach = interp.channels.pipe(buffer);
	try {
		runSync(interp, code);
		return { buffer, thrown: undefined };
	} catch (thrown) {
		return { buffer, thrown };
	} finally {
		detach();
	}
}

describe("intent forms", () => {
	test("tell the user, and only the user, the whole intent", () => {
		const { interp } = fresh();
		const { buffer } = step(
			interp,
			'(intent/todo "a" "b") (intent/doing "reading") (intent/check "a")',
		);
		const sent = buffer.envelopes.filter((e) => e.topic === journal.name);
		expect(sent.map((e) => e.to)).toEqual([
			["harness"],
			["harness"],
			["harness"],
		]);
		expect(intents(buffer).at(-1)).toEqual({
			doing: "reading",
			todos: [
				{ label: "a", done: true },
				{ label: "b", done: false },
			],
			log: [{ text: "reading", startedAt: 1000, state: "running" }],
		});
		expect(buffer.collectText("model")).toBe("");
	});

	test("keep a done mark on a label the new list keeps", () => {
		const { interp } = fresh();
		step(interp, '(intent/todo "a" "b") (intent/check "a") (intent/check "b")');
		const { buffer } = step(interp, '(intent/todo "b" "c")');
		expect(intents(buffer).at(-1)?.todos).toEqual([
			{ label: "b", done: true },
			{ label: "c", done: false },
		]);
	});

	test("refuse to check a label not on the list, naming the open ones", () => {
		const { interp } = fresh();
		step(interp, '(intent/todo "a" "b") (intent/check "a")');
		const { thrown } = step(interp, '(intent/check "z")');
		expect(thrown).toBeInstanceOf(EvalException);
		expect((thrown as Error).message).toContain('open: "b"');
		expect((thrown as Error).message).not.toContain('"a"');
	});

	test("drop a todo and keep the rest in order", () => {
		const { interp } = fresh();
		step(interp, '(intent/todo "a" "b" "c") (intent/check "c")');
		const { buffer } = step(interp, '(intent/drop "b")');
		expect(intents(buffer).at(-1)?.todos).toEqual([
			{ label: "a", done: false },
			{ label: "c", done: true },
		]);
	});

	test("move a todo to a position, and past the end to last", () => {
		const { interp } = fresh();
		step(interp, '(intent/todo "a" "b" "c")');
		const first = step(interp, '(intent/move "c" 0)');
		expect(
			intents(first.buffer)
				.at(-1)
				?.todos?.map((t) => t.label),
		).toEqual(["c", "a", "b"]);
		const last = step(interp, '(intent/move "c" 9)');
		expect(
			intents(last.buffer)
				.at(-1)
				?.todos?.map((t) => t.label),
		).toEqual(["a", "b", "c"]);
	});

	test("clear the list", () => {
		const { interp } = fresh();
		step(interp, '(intent/todo "a" "b")');
		const { buffer } = step(interp, "(intent/clear)");
		expect(intents(buffer).at(-1)?.todos).toEqual([]);
	});

	test("refuse to drop or move a label not on the list", () => {
		const { interp } = fresh();
		step(interp, '(intent/todo "a")');
		expect(step(interp, '(intent/drop "z")').thrown).toBeInstanceOf(
			EvalException,
		);
		expect(step(interp, '(intent/move "z" 0)').thrown).toBeInstanceOf(
			EvalException,
		);
	});
});

describe("a progress bar", () => {
	test("tells only the user, with the progress in the whole intent", () => {
		const { interp } = fresh();
		const { buffer } = step(
			interp,
			'(intent/todo "a") (intent/progress 2 5 "files")',
		);
		const sent = buffer.envelopes.filter((e) => e.topic === journal.name);
		expect(sent.map((e) => e.to)).toEqual([["harness"], ["harness"]]);
		expect(intents(buffer).at(-1)).toEqual({
			todos: [{ label: "a", done: false }],
			progress: { done: 2, total: 5, label: "files" },
		});
		expect(buffer.collectText("model")).toBe("");
	});

	test("takes no label, and keeps across steps and todo changes", () => {
		const { interp } = fresh();
		step(interp, "(intent/progress 1 3)");
		const { buffer } = step(interp, '(intent/todo "b") (intent/check "b")');
		expect(intents(buffer).at(-1)).toEqual({
			todos: [{ label: "b", done: true }],
			progress: { done: 1, total: 3 },
		});
	});

	test("emits each update of one step in order, as the prompt loop shows", () => {
		const { interp } = fresh();
		const { buffer, thrown } = step(
			interp,
			`(let ((i 0) (n 3))
			   (dolist (issue '("a" "b" "c"))
			     (setq i (+ i 1))
			     (intent/progress i n "issues")))`,
		);
		expect(thrown).toBeUndefined();
		expect(intents(buffer).map((i) => i.progress)).toEqual([
			{ done: 1, total: 3, label: "issues" },
			{ done: 2, total: 3, label: "issues" },
			{ done: 3, total: 3, label: "issues" },
		]);
	});

	test.each([
		["(intent/progress 4 3)", "done exceeds total"],
		["(intent/progress 0 0)", "total must be at least 1"],
		["(intent/progress -1 3)", "done must be at least 0"],
		["(intent/progress 1.5 3)", "integer expected"],
		["(intent/progress 1 3 'files)", "string expected"],
		['(intent/progress 1 3 "a" "b")', "one label"],
	])("refuses %s", (code, message) => {
		const { interp } = fresh();
		const { thrown, buffer } = step(interp, code);
		expect(thrown).toBeInstanceOf(EvalException);
		expect((thrown as Error).message).toContain(message);
		expect(intents(buffer)).toEqual([]);
	});
});

describe("a question", () => {
	test("goes to the user and ends the turn", () => {
		const { interp } = fresh();
		const { buffer } = step(
			interp,
			'(intent/ask "Which board?" \'("Sales" "Support") :multi t)',
		);
		expect(questions(buffer)).toEqual([
			{
				id: "q1",
				prompt: "Which board?",
				choices: ["Sales", "Support"],
				multi: true,
			},
		]);
		expect(buffer.envelopes.find((e) => e.topic === journal.name)?.to).toEqual([
			"harness",
		]);
		expect(buffer.collect(effect)).toEqual([{ type: "end" }]);
	});

	test("takes a fresh id each time and is single choice by default", () => {
		const { interp } = fresh();
		step(interp, '(intent/ask "p" \'("A"))');
		const { buffer } = step(interp, '(intent/ask "p" \'("A"))');
		expect(questions(buffer)[0]).toMatchObject({ id: "q2", multi: false });
	});

	test("needs a choice", () => {
		const { interp } = fresh();
		const { thrown, buffer } = step(interp, '(intent/ask "p" \'())');
		expect(thrown).toBeInstanceOf(EvalException);
		expect(buffer.collect(effect)).toEqual([]);
	});
});

describe("the journal", () => {
	test("records each intent and the question as the step runs", () => {
		const { interp } = fresh();
		const { buffer } = step(
			interp,
			'(intent/todo "a") (intent/doing "x") (intent/ask "p" \'("A" "B"))',
		);
		expect(buffer.collect(journal).map((e) => e.kind)).toEqual([
			"intent",
			"intent",
			"question",
		]);
		expect(intents(buffer).at(-1)).toEqual({
			doing: "x",
			todos: [{ label: "a", done: false }],
			log: [{ text: "x", startedAt: 1000, state: "running" }],
		});
		expect(questions(buffer)).toEqual([
			{ id: "q1", prompt: "p", choices: ["A", "B"], multi: false },
		]);
	});

	test("records nothing for a step that said nothing", () => {
		const { interp } = fresh();
		const { buffer } = step(interp, "(+ 1 2)");
		expect(buffer.collect(journal)).toEqual([]);
	});
});

describe("the doing log", () => {
	test("closes each line as done when the next one begins, with how long it took", () => {
		const { interp, clock } = fresh();
		step(interp, '(intent/doing "read")');
		clock.at = 1250;
		step(interp, '(intent/doing "sort")');
		clock.at = 1300;
		const { buffer } = step(interp, '(intent/doing "write")');
		expect(intents(buffer).at(-1)?.log).toEqual([
			{ text: "read", startedAt: 1000, ms: 250, state: "done" },
			{ text: "sort", startedAt: 1250, ms: 50, state: "done" },
			{ text: "write", startedAt: 1300, state: "running" },
		]);
	});

	test("records the running line failed when the step fails", () => {
		const { interp, hooks, clock } = fresh();
		step(interp, '(intent/doing "fetch")');
		clock.at = 1400;
		const { buffer } = failStep(
			interp,
			hooks,
			'(intent/doing "parse") (car 1)',
		);
		expect(intents(buffer).at(-1)?.log).toEqual([
			{ text: "fetch", startedAt: 1000, ms: 400, state: "done" },
			{
				text: "parse",
				startedAt: 1400,
				ms: 0,
				state: "failed",
				error: "boom",
			},
		]);
		clock.at = 1500;
		const next = step(interp, '(intent/doing "retry")');
		expect(intents(next.buffer).at(-1)?.log?.slice(1)).toEqual([
			{
				text: "parse",
				startedAt: 1400,
				ms: 0,
				state: "failed",
				error: "boom",
			},
			{ text: "retry", startedAt: 1500, state: "running" },
		]);
	});

	test("fails a line begun in an earlier step when a later step fails", () => {
		const { interp, hooks, clock } = fresh();
		step(interp, '(intent/doing "fetch")');
		clock.at = 1800;
		const { buffer } = failStep(interp, hooks, "(car 1)");
		expect(intents(buffer).at(-1)?.log).toEqual([
			{
				text: "fetch",
				startedAt: 1000,
				ms: 800,
				state: "failed",
				error: "boom",
			},
		]);
		const quiet = step(interp, "(+ 1 2)");
		expect(quiet.buffer.collect(journal)).toEqual([]);
	});

	test("closes the running line as done when the turn settles", () => {
		const { interp, hooks, clock } = fresh();
		step(interp, '(intent/doing "answer")');
		clock.at = 1600;
		settle(interp, hooks, "halt");
		expect(logOf(interp)).toBe('(("answer" 1000 600 "done"))');
	});

	test("closes the running line as done before the turn settles, in an entry the person is sent", () => {
		const { interp, hooks, clock } = fresh();
		step(interp, '(intent/doing "answer")');
		clock.at = 1600;
		const { buffer } = beforeSettle(interp, hooks, false);
		expect(intents(buffer).at(-1)?.log).toEqual([
			{ text: "answer", startedAt: 1000, ms: 600, state: "done" },
		]);
	});

	test("keeps the running line open while the turn goes on", () => {
		const { interp, hooks } = fresh();
		step(interp, '(intent/doing "answer")');
		beforeSettle(interp, hooks, true);
		expect(logOf(interp)).toBe('(("answer" 1000 nil "running"))');
	});

	test("closes the running line as failed when the turn fails", () => {
		const { interp, hooks, clock } = fresh();
		step(interp, '(intent/doing "answer")');
		clock.at = 1100;
		settle(interp, hooks, "failed");
		expect(logOf(interp)).toBe('(("answer" 1000 100 "failed"))');
	});

	test("starts empty on every turn", () => {
		const { interp, hooks, clock } = fresh();
		turnStart(interp, hooks);
		step(interp, '(intent/doing "first")');
		settle(interp, hooks, "halt");
		turnStart(interp, hooks);
		clock.at = 2000;
		const { buffer } = step(interp, '(intent/doing "second")');
		expect(intents(buffer).at(-1)?.log).toEqual([
			{ text: "second", startedAt: 2000, state: "running" },
		]);
	});

	test("cannot be set from lisp", () => {
		const { interp } = fresh();
		const { thrown } = step(interp, "(setq *intent/log* nil)");
		expect(thrown).toBeInstanceOf(EvalException);
	});
});
