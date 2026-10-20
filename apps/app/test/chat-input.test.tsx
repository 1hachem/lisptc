// @vitest-environment happy-dom
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

function render(
	onSubmit: (text: string, files: File[]) => void,
	onCommand?: (name: string) => Promise<string | null>,
): HTMLElement {
	act(() =>
		root.render(<ChatInput onSubmit={onSubmit} onCommand={onCommand} />),
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

function enter(field: HTMLElement, isComposing: boolean) {
	act(() => {
		field.dispatchEvent(
			new KeyboardEvent("keydown", {
				key: "Enter",
				bubbles: true,
				cancelable: true,
				isComposing,
			}),
		);
	});
}

describe("the chat input", () => {
	it("sends on Enter", () => {
		const onSubmit = vi.fn();
		const field = render(onSubmit);
		type(field, "hello (+ 1 2)");
		enter(field, false);
		expect(onSubmit).toHaveBeenCalledWith("hello (+ 1 2)", []);
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
		expect(onSubmit).toHaveBeenCalledWith("(let ((x 1))", []);
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

	it("offers the files for an @ and puts the one Enter picks in the text", async () => {
		const onSubmit = vi.fn();
		act(() =>
			root.render(
				<ChatInput
					onSubmit={onSubmit}
					mentions={[
						{ folder: "knowledge", name: "report.md", contentType: null },
						{ folder: "bin", name: "spec.pdf", contentType: null },
					]}
				/>,
			),
		);
		const field = host.querySelector<HTMLElement>("[contenteditable]");
		if (!field) throw new Error("no editor");
		type(field, "see @spe");
		await act(async () => {});
		expect(host.textContent).toContain("spec.pdf");
		expect(host.textContent).not.toContain("report.md");
		enter(field, false);
		await act(async () => {});
		expect(textOf(field)).toBe("see @bin/spec.pdf ");
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

	it("shows a dropped file as a chip that can be taken off again", () => {
		const field = render(vi.fn());
		const zone = host.firstElementChild;
		if (!zone) throw new Error("no drop zone");
		const file = new File(["%PDF"], "spec.pdf", { type: "application/pdf" });
		act(() => {
			const drop = new Event("drop", { bubbles: true, cancelable: true });
			Object.assign(drop, {
				dataTransfer: { types: ["Files"], files: [file] },
			});
			zone.dispatchEvent(drop);
		});
		expect(host.textContent).toContain("spec.pdf");
		const remove = host.querySelector<HTMLButtonElement>(
			'[aria-label="remove spec.pdf"]',
		);
		act(() => remove?.click());
		expect(host.textContent).not.toContain("spec.pdf");
		expect(textOf(field)).toBe("");
	});

	it("offers an attach button beside send", () => {
		render(vi.fn());
		expect(host.querySelector('button[aria-label="attach"]')).not.toBeNull();
		expect(host.querySelector('input[type="file"]')).not.toBeNull();
	});
});
