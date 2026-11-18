// @vitest-environment happy-dom
import {
	$createParagraphNode,
	$createTextNode,
	$getRoot,
	type LexicalEditor,
} from "lexical";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";

vi.mock("../src/lib/commands.ts", () => ({
	commands: [{ name: "/prompt", desc: "search what was sent" }],
	matchesCommand: (command: { name: string }, typed: string) =>
		command.name.slice(1).startsWith(typed.toLowerCase()),
}));

import { ChatInput } from "../src/components/chat-input.tsx";
import {
	type RecallDirection,
	type Recalled,
	recall,
	sentHistory,
} from "../src/lib/message-history.ts";

let host: HTMLDivElement;
let root: Root;

beforeAll(() => {
	Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
});

beforeEach(() => {
	host = document.createElement("div");
	document.body.append(host);
	root = createRoot(host);
});

afterEach(() => {
	act(() => root.unmount());
	host.remove();
});

function composer(sent: string[]): HTMLElement {
	act(() =>
		root.render(<ChatInput onSubmit={() => true} assist={{ history: sent }} />),
	);
	const field = host.querySelector<HTMLElement>("[contenteditable]");
	if (!field) throw new Error("no editor");
	return field;
}

function editorOf(field: HTMLElement): LexicalEditor {
	const editor = (field as { __lexicalEditor?: LexicalEditor }).__lexicalEditor;
	if (!editor) throw new Error("no lexical editor on the field");
	return editor;
}

function type(field: HTMLElement, text: string) {
	act(() =>
		editorOf(field).update(
			() => {
				const paragraph = $createParagraphNode().append($createTextNode(text));
				$getRoot().clear().append(paragraph);
				paragraph.selectEnd();
			},
			{ discrete: true },
		),
	);
}

function textOf(field: HTMLElement): string {
	return editorOf(field)
		.getEditorState()
		.read(() => $getRoot().getTextContent());
}

function press(field: HTMLElement, key: string) {
	act(() => {
		field.dispatchEvent(
			new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
		);
	});
}

const history = ["first", "second", "third"];

function walk(
	start: string,
	moves: RecallDirection[],
	sent: string[] = history,
): string[] {
	let recalled: Recalled | null = null;
	let text = start;
	const seen: string[] = [];
	for (const move of moves) {
		const step = recall(sent, recalled, text, move);
		if (step) {
			recalled = step.recalled;
			text = step.text;
		}
		seen.push(text);
	}
	return seen;
}

describe("recalling sent messages", () => {
	it("walks back from the newest and stops at the oldest", () => {
		expect(walk("", ["back", "back", "back", "back"])).toEqual([
			"third",
			"second",
			"first",
			"first",
		]);
	});

	it("walks forward and lands back on the empty input", () => {
		expect(walk("", ["back", "back", "forward", "forward", "forward"])).toEqual(
			["third", "second", "third", "", ""],
		);
	});
});

describe("the sent history", () => {
	it("trims, drops blanks and collapses repeats in a row", () => {
		expect(sentHistory([" a ", "a", "", "b", "a"])).toEqual(["a", "b", "a"]);
	});
});

describe("searching back with typed text", () => {
	const sent = ["deploy the app", "fix the tests", "Deploy again", "hello"];

	it("steps through the prompts that hold the text, newest first", () => {
		expect(walk("deploy", ["back", "back", "back"], sent)).toEqual([
			"Deploy again",
			"deploy the app",
			"deploy the app",
		]);
	});

	it("walks forward through the matches and back to what was typed", () => {
		expect(
			walk("deploy", ["back", "back", "forward", "forward"], sent),
		).toEqual(["Deploy again", "deploy the app", "Deploy again", "deploy"]);
	});

	it("skips a prompt that is exactly what was typed", () => {
		expect(walk("hello", ["back"], [...sent, "say hello", "hello"])).toEqual([
			"say hello",
		]);
	});
});

describe("recalling sent messages in the composer", () => {
	it("leaves a typed draft alone when nothing sent matches it", () => {
		const field = composer(history);
		type(field, "half a thought");
		press(field, "ArrowUp");
		expect(textOf(field)).toBe("half a thought");
		type(field, "");
		press(field, "ArrowDown");
		expect(textOf(field)).toBe("");
	});

	it("stops walking back once the recalled message is edited", () => {
		const field = composer(history);
		press(field, "ArrowUp");
		expect(textOf(field)).toBe("third");
		type(field, "third!");
		press(field, "ArrowUp");
		expect(textOf(field)).toBe("third!");
	});

	it("does nothing with no history", () => {
		const field = composer([]);
		press(field, "ArrowUp");
		expect(textOf(field)).toBe("");
	});

	it("lists the prompts to search newest first, each once", async () => {
		const field = composer(["alpha", "beta", "alpha", "gamma"]);
		type(field, "/prompt");
		await act(async () => {});
		press(field, "Enter");
		await act(async () => {});
		const listed = document.body.textContent ?? "";
		const at = ["gamma", "alpha", "beta"].map((p) => listed.indexOf(p));
		expect(
			at.every((index, i) => index !== -1 && (i === 0 || index > at[i - 1])),
		).toBe(true);
		expect(listed.split("alpha").length - 1).toBe(1);
	});

	it("finds the shown message again when the history grows, and keeps walking from there", () => {
		const field = composer(history);
		press(field, "ArrowUp");
		press(field, "ArrowUp");
		expect(textOf(field)).toBe("second");
		act(() =>
			root.render(
				<ChatInput
					onSubmit={() => true}
					assist={{ history: ["zeroth", ...history, "fourth"] }}
				/>,
			),
		);
		press(field, "ArrowUp");
		expect(textOf(field)).toBe("first");
		press(field, "ArrowDown");
		expect(textOf(field)).toBe("second");
	});

	it("stops browsing when the shown message is gone", () => {
		const field = composer(history);
		press(field, "ArrowUp");
		expect(textOf(field)).toBe("third");
		act(() =>
			root.render(
				<ChatInput
					onSubmit={() => true}
					assist={{ history: ["first", "second"] }}
				/>,
			),
		);
		press(field, "ArrowUp");
		expect(textOf(field)).toBe("third");
	});
});
