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
import {
	ChatInput,
	type ChatInputProps,
} from "../src/components/chat-input.tsx";
import { openQuestion } from "../src/lib/question.ts";
import { sidewaysLeaks } from "./helpers.ts";

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
	{ name: "one-arg", arity: { min: 1, max: 1 } },
	{
		name: "paint",
		args: [
			{
				name: "mode",
				type: "string",
				required: true,
				values: [{ value: "wash" }, { value: "fill" }],
			},
			{ name: "size", type: "number", required: false },
			{ name: "shade", type: "string", required: false },
		],
	},
]);

function render(
	onSubmit: ChatInputProps["onSubmit"],
	onCommand?: (name: string) => Promise<string | null>,
): HTMLElement {
	act(() =>
		root.render(
			<ChatInput
				onSubmit={onSubmit}
				assist={{ onCommand, symbols: SYMBOLS }}
			/>,
		),
	);
	const field = host.querySelector<HTMLElement>("[contenteditable]");
	if (!field) throw new Error("no editor");
	return field;
}

function renderUploading(
	onSubmit: ChatInputProps["onSubmit"],
	upload: (file: File) => Promise<string>,
): HTMLElement {
	act(() => root.render(<ChatInput onSubmit={onSubmit} files={{ upload }} />));
	const field = host.querySelector<HTMLElement>("[contenteditable]");
	if (!field) throw new Error("no editor");
	return field;
}

function attach(files: File[]) {
	const input = host.querySelector<HTMLInputElement>('input[type="file"]');
	if (!input) throw new Error("no file input");
	Object.defineProperty(input, "files", { value: files, configurable: true });
	act(() => {
		input.dispatchEvent(new Event("change", { bubbles: true }));
	});
}

function chip(name: string): HTMLElement | undefined {
	return [...host.querySelectorAll<HTMLElement>("[data-upload]")].find(
		(element) => element.textContent === name,
	);
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
					assist={{
						mentions: [
							{ folder: "knowledge", name: "report.md", contentType: null },
							{ folder: "attachments", name: "spec.pdf", contentType: null },
						],
					}}
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
		expect(textOf(field)).toBe("see @attachments/spec.pdf ");
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
		const field = renderUploading(vi.fn(), () => new Promise(() => {}));
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

	it("offers an attach button beside send only when it can upload", () => {
		render(vi.fn());
		expect(host.querySelector('button[aria-label="attach"]')).toBeNull();
		act(() =>
			root.render(<ChatInput onSubmit={vi.fn()} files={{ upload: vi.fn() }} />),
		);
		expect(host.querySelector('button[aria-label="attach"]')).not.toBeNull();
		expect(host.querySelector('input[type="file"]')).not.toBeNull();
	});

	it("uploads a file the moment it is attached", () => {
		const upload = vi.fn(() => new Promise<string>(() => {}));
		renderUploading(vi.fn(), upload);
		const file = new File(["%PDF"], "spec.pdf", { type: "application/pdf" });
		attach([file]);
		expect(upload).toHaveBeenCalledWith(file);
		expect(chip("spec.pdf")?.dataset.upload).toBe("uploading");
	});

	it("holds the message until the upload is in, then sends the stored name", async () => {
		const onSubmit = vi.fn();
		let finish: (name: string) => void = () => {};
		const upload = vi.fn(
			() =>
				new Promise<string>((resolve) => {
					finish = resolve;
				}),
		);
		const field = renderUploading(onSubmit, upload);
		attach([new File(["%PDF"], "spec.pdf")]);
		type(field, "see this");
		enter(field, false);
		expect(onSubmit).not.toHaveBeenCalled();
		expect(host.textContent).toContain("still uploading");
		expect(textOf(field)).toBe("see this");
		await act(async () => finish("spec (2).pdf"));
		expect(chip("spec.pdf")?.dataset.upload).toBe("done");
		enter(field, false);
		expect(onSubmit).toHaveBeenCalledWith("see this", ["spec (2).pdf"]);
		expect(chip("spec.pdf")).toBeUndefined();
	});

	it("holds a send while an upload has failed, and drops it on a second enter", async () => {
		const onSubmit = vi.fn();
		const upload = vi.fn(() =>
			Promise.reject(new Error("spec.pdf not uploaded: the folder is full")),
		);
		const field = renderUploading(onSubmit, upload);
		attach([new File(["%PDF"], "spec.pdf")]);
		await settled();
		expect(chip("spec.pdf")?.dataset.upload).toBe("failed");
		expect(chip("spec.pdf")?.title).toBe(
			"spec.pdf not uploaded: the folder is full",
		);
		type(field, "see this");
		enter(field, false);
		expect(onSubmit).not.toHaveBeenCalled();
		expect(host.textContent).toContain(
			"a file failed to upload, press enter again to remove it and send",
		);
		expect(chip("spec.pdf")?.dataset.upload).toBe("failed");
		enter(field, false);
		expect(onSubmit).toHaveBeenCalledWith("see this", []);
		expect(chip("spec.pdf")).toBeUndefined();
	});

	it("warns again when a different upload fails after the first was removed", async () => {
		const onSubmit = vi.fn();
		const upload = vi.fn((file: File) =>
			Promise.reject(new Error(`${file.name} not uploaded`)),
		);
		const field = renderUploading(onSubmit, upload);
		attach([new File(["%PDF"], "spec.pdf")]);
		await settled();
		type(field, "see this");
		enter(field, false);
		act(() =>
			host
				.querySelector<HTMLButtonElement>(
					'button[aria-label="remove spec.pdf"]',
				)
				?.click(),
		);
		attach([new File(["%PDF"], "plan.pdf")]);
		await settled();
		enter(field, false);
		expect(onSubmit).not.toHaveBeenCalled();
		expect(chip("plan.pdf")?.dataset.upload).toBe("failed");
		enter(field, false);
		expect(onSubmit).toHaveBeenCalledWith("see this", []);
	});

	it("deletes an uploaded file removed before sending", async () => {
		const discard = vi.fn();
		const upload = vi.fn(() => Promise.resolve("spec.pdf"));
		act(() =>
			root.render(<ChatInput onSubmit={vi.fn()} files={{ upload, discard }} />),
		);
		attach([new File(["%PDF"], "spec.pdf")]);
		await settled();
		act(() =>
			host
				.querySelector<HTMLButtonElement>(
					'button[aria-label="remove spec.pdf"]',
				)
				?.click(),
		);
		expect(discard).toHaveBeenCalledWith("spec.pdf");
		expect(chip("spec.pdf")).toBeUndefined();
	});

	it("deletes a file whose upload lands after it was removed", async () => {
		const discard = vi.fn();
		let finish: (name: string) => void = () => {};
		const upload = vi.fn(
			() =>
				new Promise<string>((resolve) => {
					finish = resolve;
				}),
		);
		act(() =>
			root.render(<ChatInput onSubmit={vi.fn()} files={{ upload, discard }} />),
		);
		attach([new File(["%PDF"], "spec.pdf")]);
		act(() =>
			host
				.querySelector<HTMLButtonElement>(
					'button[aria-label="remove spec.pdf"]',
				)
				?.click(),
		);
		expect(discard).not.toHaveBeenCalled();
		await act(async () => finish("spec.pdf"));
		expect(discard).toHaveBeenCalledWith("spec.pdf");
	});

	it("puts the text and the files back when a send fails", async () => {
		const onSubmit = vi.fn(() => Promise.resolve(false));
		const upload = vi.fn(() => Promise.resolve("spec.pdf"));
		const field = renderUploading(onSubmit, upload);
		attach([new File(["%PDF"], "spec.pdf")]);
		await settled();
		type(field, "see this");
		enter(field, false);
		expect(onSubmit).toHaveBeenCalledWith("see this", ["spec.pdf"]);
		await settled();
		expect(textOf(field)).toBe("see this");
		expect(chip("spec.pdf")?.dataset.upload).toBe("done");
		expect(host.textContent).toContain("not sent");
	});

	it("sends files alone, with no text", async () => {
		const onSubmit = vi.fn();
		const upload = vi.fn(() => Promise.resolve("spec.pdf"));
		const field = renderUploading(onSubmit, upload);
		attach([new File(["%PDF"], "spec.pdf")]);
		await settled();
		enter(field, false);
		expect(onSubmit).toHaveBeenCalledWith("", ["spec.pdf"]);
		await settled();
		expect(chip("spec.pdf")).toBeUndefined();
	});

	it("holds a send while it is blocked, and says why on the button", () => {
		const onSubmit = vi.fn();
		act(() =>
			root.render(
				<ChatInput
					onSubmit={onSubmit}
					blocked="the file is still loading, send once it shows"
				/>,
			),
		);
		const field = host.querySelector<HTMLElement>("[contenteditable]");
		if (!field) throw new Error("no editor");
		const button = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
			(candidate) => candidate.textContent?.startsWith("send"),
		);
		expect(button?.disabled).toBe(true);
		expect(button?.title).toBe("the file is still loading, send once it shows");
		type(field, "summarize it");
		enter(field, false);
		expect(onSubmit).not.toHaveBeenCalled();
		expect(textOf(field)).toBe("summarize it");
		expect(host.textContent).toContain("still loading");
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
		expect(document.querySelector('[role="tooltip"]')).toBeNull();
		await paused();
		const tip = document.querySelector<HTMLElement>('[role="tooltip"]');
		expect(tip?.style.visibility).not.toBe("hidden");
		expect(tip?.textContent).toContain("(list-length xs)");
		expect(tip?.textContent).toContain("Count the items of xs.");
		expect(host.textContent).not.toContain("Count the items of xs.");
	});

	it("underlines the form an error is about, in smaller text below", async () => {
		const highlights = new Map<string, { size: number }>();
		vi.stubGlobal("CSS", { highlights });
		vi.stubGlobal(
			"Highlight",
			class {
				size: number;
				constructor(...ranges: Range[]) {
					this.size = ranges.length;
				}
			},
		);
		const field = render(vi.fn());
		type(field, "(one-arg)");
		await paused();
		expect(highlights.get("lisp-error")?.size).toBe(1);
		const problem = host.querySelector(".text-red");
		expect(problem?.className).toContain("text-[11px]");
		vi.unstubAllGlobals();
	});

	it("hides the attach button, and Enter still sends", () => {
		const onSubmit = vi.fn();
		act(() =>
			root.render(<ChatInput onSubmit={onSubmit} on={{ attach: false }} />),
		);
		expect(host.querySelector('[aria-label="attach"]')).toBeNull();
		const field = host.querySelector<HTMLElement>("[contenteditable]");
		if (!field) throw new Error("no editor");
		type(field, "hello");
		enter(field, false);
		expect(onSubmit).toHaveBeenCalledWith("hello", []);
	});

	it("runs no lisp help in the input when the preference is off", async () => {
		act(() =>
			root.render(
				<ChatInput
					onSubmit={vi.fn()}
					assist={{ symbols: SYMBOLS }}
					on={{ lisp: false }}
				/>,
			),
		);
		const field = host.querySelector<HTMLElement>("[contenteditable]");
		if (!field) throw new Error("no editor");
		await completing(field, "(list-");
		expect(field.querySelector('[class^="th-"]')).toBeNull();
		expect(host.textContent).not.toContain("list-reverse");
	});

	it("says (lisp) runs inline only while the lisp preference is on", () => {
		const hint = (lisp: boolean) => {
			act(() =>
				root.render(
					<ChatInput
						placeholder="type a message"
						onSubmit={vi.fn()}
						assist={{ onCommand: vi.fn() }}
						on={{ lisp }}
					/>,
				),
			);
			return host
				.querySelector("[contenteditable]")
				?.getAttribute("aria-placeholder");
		};
		expect(hint(true)).toBe(
			"type a message, (lisp) runs inline  ·  / for commands",
		);
		expect(hint(false)).toBe("type a message  ·  / for commands");
	});

	it("closes the open form on Tab when nothing completes", async () => {
		const field = render(vi.fn());
		type(field, "(one-arg 1");
		press(field, { key: "Tab" });
		await settled();
		expect(textOf(field)).toBe("(one-arg 1)");
	});

	it("closes an open string on Tab before the form around it", async () => {
		const field = render(vi.fn());
		type(field, '(one-arg "hi');
		press(field, { key: "Tab" });
		await settled();
		expect(textOf(field)).toBe('(one-arg "hi"');
		press(field, { key: "Tab" });
		await settled();
		expect(textOf(field)).toBe('(one-arg "hi")');
	});

	it("offers a fully typed name first, with its doc", async () => {
		const field = render(vi.fn());
		await completing(field, "(list-length");
		const rows = [...host.querySelectorAll('[role="option"]')];
		expect(rows[0]?.textContent).toContain("list-length");
		await paused();
		expect(document.querySelector('[role="tooltip"]')?.textContent).toContain(
			"Count the items of xs.",
		);
	});

	it("offers an argument's declared values as soon as its string opens", async () => {
		const field = render(vi.fn());
		await completing(field, '(await (paint "');
		expect(host.textContent).toContain("wash");
		expect(host.textContent).toContain("fill");
		enter(field, false);
		await settled();
		expect(textOf(field)).toBe('(await (paint "wash');
	});

	it("offers the call's keyword arguments at once after a colon", async () => {
		const field = render(vi.fn());
		type(field, '(paint :mode "wash" :');
		await settled();
		const rows = [...host.querySelectorAll('[role="option"]')].map(
			(row) => row.textContent,
		);
		expect(rows.some((row) => row?.includes(":size"))).toBe(true);
		expect(rows.some((row) => row?.includes(":shade"))).toBe(true);
		expect(rows.some((row) => row?.includes(":mode"))).toBe(false);
		expect(rows.some((row) => row?.includes("list-length"))).toBe(false);
		enter(field, false);
		await settled();
		expect(textOf(field)).toBe('(paint :mode "wash" :shade');
	});

	it("narrows the keyword arguments as the name is typed", async () => {
		const field = render(vi.fn());
		await completing(field, "(paint :sh");
		enter(field, false);
		await settled();
		expect(textOf(field)).toBe("(paint :shade");
	});

	it("cycles to the next completion on each Tab right after one", async () => {
		const field = render(vi.fn());
		await completing(field, "(list-");
		press(field, { key: "Tab" });
		await settled();
		expect(textOf(field)).toBe("(list-length");
		press(field, { key: "Tab" });
		await settled();
		expect(textOf(field)).toBe("(list-reverse");
		press(field, { key: "Tab" });
		await settled();
		expect(textOf(field)).toBe("(list-length");
	});

	it("stops cycling once something is typed", async () => {
		const field = render(vi.fn());
		await completing(field, "(list-");
		press(field, { key: "Tab" });
		await settled();
		typeAtCaret(field, " ");
		press(field, { key: "Tab" });
		await settled();
		expect(textOf(field)).toBe("(list-length )");
	});
});

const PICK_ONE = {
	id: "q1",
	prompt: "which colour?",
	choices: ["red", "green", "blue"],
	multi: false,
};

const PICK_MANY = { ...PICK_ONE, id: "q2", multi: true };

function renderAsking(
	onSubmit: (text: string, attached: string[]) => void,
	question: typeof PICK_ONE | undefined,
) {
	act(() => root.render(<ChatInput onSubmit={onSubmit} question={question} />));
}

function button(label: string): HTMLButtonElement {
	const found = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
		(element) => element.textContent?.includes(label),
	);
	if (!found) throw new Error(`no ${label} button`);
	return found;
}

function click(element: HTMLElement) {
	act(() => element.click());
}

function key(name: string) {
	press(document.body, { key: name });
}

function editorShown(): boolean {
	return host.querySelector("[contenteditable]") !== null;
}

describe("the chat input with a question open", () => {
	it("shows the prompt and its choices in place of the editor", () => {
		renderAsking(vi.fn(), PICK_ONE);
		expect(editorShown()).toBe(false);
		expect(host.textContent).toContain("which colour?");
		expect(button("green")).toBeDefined();
	});

	it("answers a single choice on click", () => {
		const onSubmit = vi.fn();
		renderAsking(onSubmit, PICK_ONE);
		click(button("green"));
		expect(onSubmit).toHaveBeenCalledWith("green", []);
	});

	it("answers a single choice by its number", () => {
		const onSubmit = vi.fn();
		renderAsking(onSubmit, PICK_ONE);
		key("3");
		expect(onSubmit).toHaveBeenCalledWith("blue", []);
	});

	it("ignores a number past the choices", () => {
		const onSubmit = vi.fn();
		renderAsking(onSubmit, PICK_ONE);
		key("4");
		expect(onSubmit).not.toHaveBeenCalled();
	});

	it("sends the checked choices of a multi question in list order", () => {
		const onSubmit = vi.fn();
		renderAsking(onSubmit, PICK_MANY);
		const send = button("send");
		expect(send.disabled).toBe(true);
		click(button("blue"));
		click(button("red"));
		expect(button("blue").getAttribute("aria-pressed")).toBe("true");
		expect(onSubmit).not.toHaveBeenCalled();
		click(button("send"));
		expect(onSubmit).toHaveBeenCalledWith("red, blue", []);
	});

	it("toggles multi choices by number and sends on Enter", () => {
		const onSubmit = vi.fn();
		renderAsking(onSubmit, PICK_MANY);
		key("Enter");
		expect(onSubmit).not.toHaveBeenCalled();
		key("1");
		key("2");
		key("1");
		key("Enter");
		expect(onSubmit).toHaveBeenCalledWith("green", []);
	});

	it("restores the editor to type a free answer", () => {
		const onSubmit = vi.fn();
		renderAsking(onSubmit, PICK_ONE);
		click(button("type instead"));
		expect(editorShown()).toBe(true);
		const field = host.querySelector<HTMLElement>("[contenteditable]");
		if (!field) throw new Error("no editor");
		type(field, "purple");
		enter(field, false);
		expect(onSubmit).toHaveBeenCalledWith("purple", []);
	});

	it("restores the editor on Escape", () => {
		renderAsking(vi.fn(), PICK_ONE);
		key("Escape");
		expect(editorShown()).toBe(true);
	});

	it("opens the picker again for the next question", () => {
		renderAsking(vi.fn(), PICK_ONE);
		key("Escape");
		renderAsking(vi.fn(), PICK_MANY);
		expect(editorShown()).toBe(false);
	});

	it("keeps the editor while the agent is streaming", () => {
		act(() =>
			root.render(
				<ChatInput
					onSubmit={vi.fn()}
					question={PICK_ONE}
					streaming={{ active: true, onStop: vi.fn() }}
				/>,
			),
		);
		expect(editorShown()).toBe(true);
	});

	it("keeps the editor once a human message answers the question", () => {
		const asked = { type: "tool", additional_kwargs: { question: PICK_ONE } };
		renderAsking(
			vi.fn(),
			openQuestion([asked, { type: "ai" }, { type: "human" }]),
		);
		expect(editorShown()).toBe(true);
		renderAsking(vi.fn(), openQuestion([asked]));
		expect(editorShown()).toBe(false);
	});
});

describe("a question with long choices", () => {
	it("wraps and truncates inside the input, never pushing the chat sideways", () => {
		const long = "x".repeat(400);
		renderAsking(vi.fn(), {
			id: "q9",
			prompt: `pick ${long}`,
			choices: [long, `${long}-two`, "short"],
			multi: true,
		});

		expect(sidewaysLeaks(host)).toEqual([]);
	});
});
