// @vitest-environment happy-dom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { PromptDialog } from "./prompt-dialog.tsx";

beforeAll(() => {
	(
		globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
	).IS_REACT_ACT_ENVIRONMENT = true;
	globalThis.ResizeObserver ??= class {
		observe() {}
		unobserve() {}
		disconnect() {}
	};
	Element.prototype.scrollIntoView ??= () => {};
});

let root: Root | null = null;

afterEach(async () => {
	await act(async () => root?.unmount());
	root = null;
	document.body.replaceChildren();
});

function Composer({ prompts }: { prompts: string[] }) {
	const [open, setOpen] = useState(true);
	const [draft, setDraft] = useState("");
	return (
		<>
			<textarea aria-label="draft" value={draft} readOnly />
			<PromptDialog
				onOpenChange={setOpen}
				onSelect={setDraft}
				open={open}
				prompts={prompts}
			/>
		</>
	);
}

function items() {
	return [...document.querySelectorAll<HTMLElement>("[cmdk-item]")];
}

describe("searching previous prompts", () => {
	it("puts the whole prompt back in the draft, not its one-line preview, and closes", async () => {
		const host = document.createElement("div");
		document.body.append(host);
		root = createRoot(host);
		await act(async () => {
			root?.render(<Composer prompts={["newest", "two\nlines"]} />);
		});
		await act(async () =>
			items()
				.find((item) => item.textContent === "two lines")
				?.click(),
		);
		expect(
			host.querySelector<HTMLTextAreaElement>('[aria-label="draft"]')?.value,
		).toBe("two\nlines");
		expect(document.body.textContent).not.toContain("newest");
	});
});
