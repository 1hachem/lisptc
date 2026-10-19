// @vitest-environment happy-dom

import { symbolTable } from "@repo/language-service";
import {
	$createParagraphNode,
	$createTextNode,
	$getRoot,
	$getSelection,
	$isRangeSelection,
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
import { ChatInput } from "../src/components/chat-input.tsx";

vi.mock("../src/lib/commands.ts", () => ({
	commands: [{ name: "/clear", desc: "start a fresh session" }],
	matchesCommand: (command: { name: string }, typed: string) =>
		command.name.slice(1).startsWith(typed.toLowerCase()),
}));

let host: HTMLDivElement;
let root: Root;

beforeAll(() => {
	(
		globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
	).IS_REACT_ACT_ENVIRONMENT = true;
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

const SYMBOLS = symbolTable([
	{
		name: "list-length",
		signature: "(list-length xs)",
		doc: "Count the items of xs.",
	},
	{ name: "list-reverse" },
]);

function render(
	onSubmit: (text: string) => void,
	onCommand?: (name: string) => Promise<string | null>,
): HTMLElement {
	act(() =>
		root.render(
			<ChatInput onSubmit={onSubmit} onCommand={onCommand} symbols={SYMBOLS} />,
		),
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

function typeAtCaret(field: HTMLElement, text: string) {
	act(() =>
		editorOf(field).update(
			() => {
				const selection = $getSelection();
				if ($isRangeSelection(selection)) selection.insertText(text);
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

function press(field: HTMLElement, init: KeyboardEventInit) {
	act(() => {
		field.dispatchEvent(
			new KeyboardEvent("keydown", {
				bubbles: true,
				cancelable: true,
				...init,
			}),
		);
	});
}

function enter(field: HTMLElement, isComposing: boolean) {
	press(field, { key: "Enter", isComposing });
}

async function settled() {
	await act(async () => {});
}

async function paused() {
	await act(() => new Promise((settle) => setTimeout(settle, 400)));
}

async function completing(field: HTMLElement, text: string) {
	type(field, text);
	await paused();
}

function caretInto(field: HTMLElement, word: string, offset: number) {
	act(() =>
		editorOf(field).update(
			() => {
				const node = $getRoot()
					.getAllTextNodes()
					.find((text) => text.getTextContent() === word);
				if (!node) throw new Error(`no ${word} token`);
				node.select(offset, offset);
			},
			{ discrete: true },
		),
	);
}

describe("the chat input", () => {
	it("sends on Enter", () => {
		const onSubmit = vi.fn();
		const field = render(onSubmit);
		type(field, "hello (+ 1 2)");
		enter(field, false);
		expect(onSubmit).toHaveBeenCalledWith("hello (+ 1 2)");
		expect(textOf(field)).toBe("");
	});

	it("leaves an Enter that commits an input-method composition alone", () => {
		const onSubmit = vi.fn();
		const field = render(onSubmit);
		type(field, "にほん");
		enter(field, true);
		expect(onSubmit).not.toHaveBeenCalled();
		expect(textOf(field)).toBe("にほん");
	});

	it("sends on Enter while a form is still open", () => {
		const onSubmit = vi.fn();
		const field = render(onSubmit);
		type(field, "(let ((x 1))");
		enter(field, false);
		expect(onSubmit).toHaveBeenCalledWith("(let ((x 1))");
	});

	it("offers the commands for a leading slash and runs the one Enter picks", async () => {
		const onSubmit = vi.fn();
		const onCommand = vi.fn(async () => null);
		const field = render(onSubmit, onCommand);
		type(field, "/cl");
		await act(async () => {});
		expect(host.textContent).toContain("start a fresh session");
		enter(field, false);
		expect(onCommand).toHaveBeenCalledWith("/clear");
		expect(onSubmit).not.toHaveBeenCalled();
	});

	it("keeps the menu's caret anchor out of the page layout", async () => {
		const field = render(vi.fn());
		type(field, "/cl");
		await act(async () => {});
		expect(document.getElementById("typeahead-menu")?.className).toContain(
			"hidden!",
		);
	});

	it("highlights the forms in the text without changing it", () => {
		const field = render(vi.fn());
		type(field, "hello (+ 1 2)");
		expect(field.querySelector('[class^="th-"]')).not.toBeNull();
		expect(field.textContent).toBe("hello (+ 1 2)");
	});

	it("keeps the caret in place when typing splits a form into new tokens", () => {
		const field = render(vi.fn());
		type(field, "see (+ 1");
		typeAtCaret(field, " 2) ok");
		expect(textOf(field)).toBe("see (+ 1 2) ok");
	});

	it("completes the highlighted symbol on Enter instead of sending", async () => {
		const onSubmit = vi.fn();
		const field = render(onSubmit);
		await completing(field, "(list-");
		expect(host.textContent).toContain("list-reverse");
		enter(field, false);
		await settled();
		expect(textOf(field)).toBe("(list-length");
		expect(onSubmit).not.toHaveBeenCalled();
	});

	it("completes the highlighted symbol on Tab", async () => {
		const field = render(vi.fn());
		await completing(field, "(list-");
		press(field, { key: "Tab" });
		await settled();
		expect(textOf(field)).toBe("(list-length");
	});

	it("completes the symbol a click picks", async () => {
		const field = render(vi.fn());
		await completing(field, "(list-");
		const row = [...host.querySelectorAll("button")].find((button) =>
			button.textContent?.includes("list-reverse"),
		);
		act(() => row?.click());
		await settled();
		expect(textOf(field)).toBe("(list-reverse");
	});

	it("waits for typing to pause before offering completions", () => {
		const field = render(vi.fn());
		type(field, "(list-");
		expect(host.textContent).not.toContain("list-reverse");
	});

	it("opens the completions at once on Tab", async () => {
		const field = render(vi.fn());
		type(field, "(list-");
		press(field, { key: "Tab" });
		await settled();
		expect(host.textContent).toContain("list-reverse");
		press(field, { key: "Tab" });
		await settled();
		expect(textOf(field)).toBe("(list-length");
	});

	it("offers nothing when a backspace walks back into a word", async () => {
		const field = render(vi.fn());
		type(field, "(list-length");
		await paused();
		type(field, "(list-lengt");
		await paused();
		expect(host.textContent).not.toContain("list-reverse");
	});

	it("offers nothing when the caret moves back into a word", async () => {
		const field = render(vi.fn());
		type(field, "(list-length 1)");
		await paused();
		caretInto(field, "list-length", 5);
		await paused();
		expect(host.textContent).not.toContain("list-reverse");
	});

	it("finds a symbol from letters that are not contiguous", async () => {
		const field = render(vi.fn());
		await completing(field, "(lrev");
		press(field, { key: "Tab" });
		await settled();
		expect(textOf(field)).toBe("(list-reverse");
	});

	it("replaces the rest of the word when completing inside it", async () => {
		const field = render(vi.fn());
		type(field, "(list-gth 1)");
		caretInto(field, "list-gth", 5);
		press(field, { key: "Tab" });
		await settled();
		press(field, { key: "Tab" });
		await settled();
		expect(textOf(field)).toBe("(list-length 1)");
	});

	it("shows the signature and doc of the highlighted completion", async () => {
		const field = render(vi.fn());
		await completing(field, "(list-");
		const tip = document.querySelector('[role="tooltip"]');
		expect(tip?.textContent).toContain("(list-length xs)");
		expect(tip?.textContent).toContain("Count the items of xs.");
		expect(host.textContent).not.toContain("Count the items of xs.");
	});
});
