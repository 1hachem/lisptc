import { conversationSlot } from "@repo/interpreter/conversation";
import { restore, snapshot } from "@repo/interpreter/image";
import { Interp, runSync } from "@repo/interpreter/lisp";
import { prelude } from "@repo/interpreter/prelude";
import { str } from "@repo/interpreter/print";
import {
	type ConversationEntry,
	type InterpExtension,
	openSession,
} from "@repo/interpreter/session";
import { describe, expect, it } from "vitest";
import { conversationExtension } from "../src/conversation.ts";
import { conversationHost } from "../src/conversation-host.ts";

const GLOBALS = ["conversation", "user-messages", "assistant-messages"];

const said: ConversationEntry[] = [
	{ role: "user", content: "add one and two" },
	{ role: "assistant", content: "(echo (+ 1 2))" },
	{ role: "tool", content: "3" },
	{ role: "system", content: "a file landed" },
];

function session(
	extension: InterpExtension = conversationExtension(conversationHost),
) {
	const interp = new Interp({ extensions: [extension] });
	runSync(interp, prelude);
	const hooks = openSession([extension]);
	return {
		interp,
		read: (code: string) => str(runSync(interp, code), true),
		record: (...entries: ConversationEntry[]) => {
			for (const entry of entries) hooks.recorded.run(() => {}, interp, entry);
		},
		entries: () => hooks.filled(conversationSlot)?.entries(interp),
		replace: (entries: readonly ConversationEntry[]) =>
			hooks.filled(conversationSlot)?.replace(interp, entries),
	};
}

describe("the extension", () => {
	it("takes its prompt from the host", () => {
		expect(conversationExtension({ prompt: () => "supplied" }).prompt).toBe(
			"supplied",
		);
	});

	it("names in its prompt every global it defines", () => {
		const prompt = conversationExtension(conversationHost).prompt ?? "";
		for (const name of GLOBALS) expect(prompt).toContain(`\`${name}\``);
	});
});

describe("the conversation in the image", () => {
	it("starts empty", () => {
		const s = session();
		for (const name of GLOBALS) expect(s.read(name)).toBe("nil");
		expect(s.entries()).toEqual([]);
	});

	it("grows by each recorded entry", () => {
		const s = session();
		s.record(...said);
		expect(s.read("(length conversation)")).toBe("4");
		expect(s.read('(cdr (assoc "content" (car conversation)))')).toBe(
			'"add one and two"',
		);
		expect(s.read("user-messages")).toBe('("add one and two")');
		expect(s.read("assistant-messages")).toBe('("(echo (+ 1 2))")');
		expect(s.entries()).toEqual(said);
	});

	it("carries a stopped step's problems", () => {
		const s = session();
		const problems = [{ line: 1, message: "car: expected 1 argument, got 0" }];
		s.record(
			{ role: "assistant", content: "(echo (car))" },
			{ role: "tool", content: "not run", problems },
		);
		expect(
			s.read(
				'(cdr (assoc "message" (car (cdr (assoc "problems" (cadr conversation))))))',
			),
		).toBe('"car: expected 1 argument, got 0"');
		expect(s.entries()?.at(-1)).toEqual({
			role: "tool",
			content: "not run",
			problems,
		});
	});

	it("refuses a setq on its globals", () => {
		const s = session();
		s.record(...said);
		for (const name of GLOBALS) {
			expect(() => s.read(`(setq ${name} nil)`)).toThrow(/read-only/);
		}
		expect(s.read("(length conversation)")).toBe("4");
	});

	it("survives a snapshot and restore", () => {
		const before = session();
		before.record(...said);
		const after = session();
		restore(after.interp, snapshot(before.interp));
		expect(after.entries()).toEqual(said);
		expect(after.read("(car user-messages)")).toBe('"add one and two"');
		expect(() => after.read("(setq conversation nil)")).toThrow(/read-only/);
	});

	it("is replaced whole by its owner and stays sealed", () => {
		const s = session();
		s.record(...said);
		const kept = said.slice(0, 2);
		s.replace(kept);
		expect(s.entries()).toEqual(kept);
		expect(s.read("user-messages")).toBe('("add one and two")');
		expect(s.read("assistant-messages")).toBe('("(echo (+ 1 2))")');
		s.replace([]);
		for (const name of GLOBALS) expect(s.read(name)).toBe("nil");
		expect(() => s.read("(setq conversation nil)")).toThrow(/read-only/);
		s.record(said[0]);
		expect(s.entries()).toEqual([said[0]]);
	});
});
