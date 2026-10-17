// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { WrittenAs } from "../src/components/written-as.tsx";
import type { ChatMessage } from "../src/lib/chat.tsx";
import { lineDiff } from "../src/lib/line-diff.ts";
import { messageWritten } from "../src/lib/written.ts";

beforeAll(() => {
	(
		globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
	).IS_REACT_ACT_ENVIRONMENT = true;
});

const roots: Root[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) act(() => root.unmount());
	document.body.innerHTML = "";
});

function mount(node: React.ReactNode): HTMLElement {
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	roots.push(root);
	act(() => root.render(node));
	return host;
}

describe("lineDiff", () => {
	it("keeps the lines both share and marks the ones that changed", () => {
		expect(lineDiff("(a)\n(totl x)\n(c)", "(a)\n(total x)\n(c)")).toEqual([
			{ kind: "same", text: "(a)" },
			{ kind: "removed", text: "(totl x)" },
			{ kind: "added", text: "(total x)" },
			{ kind: "same", text: "(c)" },
		]);
	});

	it("reports lines only one side has", () => {
		expect(lineDiff("(a)", "(a)\n(b)")).toEqual([
			{ kind: "same", text: "(a)" },
			{ kind: "added", text: "(b)" },
		]);
	});
});

describe("messageWritten", () => {
	const step = (written: unknown): ChatMessage => ({
		id: "s",
		type: "ai",
		content: "(total x)",
		additional_kwargs: { written },
	});

	it("reads what was written, why, and what it was made from", () => {
		expect(
			messageWritten(
				step({
					text: "(rename totl total)",
					because: "edited",
					from: "(totl x)",
				}),
			),
		).toEqual({
			text: "(rename totl total)",
			because: "edited",
			from: "(totl x)",
		});
	});

	it("ignores a step that ran what was written", () => {
		expect(
			messageWritten({ id: "s", type: "ai", content: "(a)" }),
		).toBeUndefined();
		expect(messageWritten(step({ because: "no text" }))).toBeUndefined();
	});
});

describe("WrittenAs", () => {
	it("shows what was written and why, with the changes behind a toggle", () => {
		const host = mount(
			<WrittenAs
				written={{
					text: "(rename totl total)",
					because: "edited the code the check stopped",
					from: "(echo (totl x))",
				}}
				ran="(echo (total x))"
			/>,
		);
		expect(host.textContent).toContain("(rename totl total)");
		expect(host.textContent).toContain("edited the code the check stopped");
		const change = (kind: string) =>
			[...host.querySelectorAll(`[data-change="${kind}"]`)].map(
				(line) => line.textContent,
			);
		expect(change("removed")).toEqual([]);
		const toggle = [...host.querySelectorAll("button")].find(
			(b) => b.textContent === "show changes",
		);
		act(() => toggle?.click());
		expect(change("removed")).toEqual(["-(echo (totl x))"]);
		expect(change("added")).toEqual(["+(echo (total x))"]);
	});

	it("draws no icon, only the text as written", () => {
		const host = mount(<WrittenAs written={{ text: "(fix)" }} ran="(+ 1 1)" />);
		expect(host.querySelector("svg")).toBeNull();
	});

	it("offers no changes when it does not know what the code was made from", () => {
		const host = mount(<WrittenAs written={{ text: "(fix)" }} ran="(+ 1 1)" />);
		expect(host.querySelector("button")).toBeNull();
	});
});
