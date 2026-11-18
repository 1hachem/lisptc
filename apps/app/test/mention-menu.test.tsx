// @vitest-environment happy-dom
import {
	$createParagraphNode,
	$createTextNode,
	$getRoot,
	type LexicalEditor,
} from "lexical";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/commands.ts", () => ({
	commands: [],
	matchesCommand: () => false,
}));

import { ChatInput } from "../src/components/chat-input.tsx";
import {
	type Mentionable,
	mentionOf,
} from "../src/components/mention-menu.tsx";

const files: Mentionable[] = [
	{ folder: "knowledge", name: "report.md", contentType: "text/markdown" },
	{ folder: "knowledge", name: "Q3 Sales.json", contentType: null },
	{ folder: "attachments", name: "spec.pdf", contentType: "application/pdf" },
	{ folder: "sub-agents", name: "researcher", contentType: null },
];

beforeAll(() => {
	Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
});

function editorOf(field: Element | null): LexicalEditor {
	const editor = (field as { __lexicalEditor?: LexicalEditor } | null)
		?.__lexicalEditor;
	if (!editor) throw new Error("no lexical editor");
	return editor;
}

async function mentioning(typed: string) {
	const host = document.createElement("div");
	document.body.append(host);
	act(() =>
		createRoot(host).render(
			<ChatInput onSubmit={() => true} assist={{ mentions: files }} />,
		),
	);
	const field = host.querySelector("[contenteditable]");
	act(() =>
		editorOf(field).update(
			() => {
				const paragraph = $createParagraphNode().append($createTextNode(typed));
				$getRoot().clear().append(paragraph);
				paragraph.selectEnd();
			},
			{ discrete: true },
		),
	);
	await act(async () => {});
	return {
		offered: (name: string) => host.textContent?.includes(name) ?? false,
		async pick() {
			act(() => {
				field?.dispatchEvent(
					new KeyboardEvent("keydown", {
						key: "Enter",
						bubbles: true,
						cancelable: true,
					}),
				);
			});
			await act(async () => {});
			return editorOf(field)
				.getEditorState()
				.read(() => $getRoot().getTextContent());
		},
	};
}

describe("a file mention", () => {
	it("is quoted when the name holds a space", () => {
		expect(mentionOf(files[1])).toBe('@"knowledge/Q3 Sales.json"');
	});

	it("names a saved sub-agent under its folder", async () => {
		const menu = await mentioning("ask @sub-agents");
		expect(menu.offered("researcher")).toBe(true);
		expect(menu.offered("report.md")).toBe(false);
		expect(await menu.pick()).toBe("ask @sub-agents/researcher ");
	});

	it("offers the files whose folder or name holds what was typed", async () => {
		const all = await mentioning("@");
		for (const file of files) expect(all.offered(file.name)).toBe(true);
		const attached = await mentioning("@attachments");
		expect(attached.offered("spec.pdf")).toBe(true);
		expect(attached.offered("report.md")).toBe(false);
		const sales = await mentioning("@sal");
		expect(sales.offered("Q3 Sales.json")).toBe(true);
		expect(sales.offered("spec.pdf")).toBe(false);
	});
});
