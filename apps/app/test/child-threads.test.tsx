// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
	type ChildThread,
	ChildThreadStrip,
} from "../src/components/child-threads.tsx";

beforeAll(() => {
	(
		globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
	).IS_REACT_ACT_ENVIRONMENT = true;
});

const roots: Root[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) act(() => root.unmount());
	document.body.replaceChildren();
});

function mount(threads: ChildThread[], onOpen = vi.fn()) {
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	roots.push(root);
	act(() =>
		root.render(<ChildThreadStrip threads={threads} onOpen={onOpen} />),
	);
	return host;
}

const THREADS: ChildThread[] = [
	{ _id: "a", title: "researcher", status: "streaming" },
	{ _id: "b", title: "reviewer", status: "waiting" },
	{ _id: "c", title: "coder", status: "errored", failure: "boom" },
	{ _id: "d", title: "" },
];

describe("child threads", () => {
	it("is hidden when the chat spawned none", () => {
		expect(mount([]).childElementCount).toBe(0);
	});

	it("counts the children and shows a state for each", () => {
		const host = mount(THREADS);
		expect(host.textContent).toContain("4 threads");
		const buttons = [...host.querySelectorAll("button")];
		expect(buttons.map((b) => b.dataset.state)).toEqual([
			"running",
			"waiting",
			"errored",
			"idle",
		]);
		expect(buttons.map((b) => b.title)).toEqual([
			"running",
			"waiting",
			"boom",
			"idle",
		]);
		expect(buttons[3].textContent).toContain("untitled");
	});

	it("marks a background job apart from a sub-agent", () => {
		const host = mount([
			THREADS[0],
			{ _id: "j", title: "poll", status: "streaming", job: true },
		]);
		const kinds = [
			...host.querySelectorAll<SVGElement>("button[data-state] [data-kind]"),
		];
		expect(kinds.map((icon) => icon.dataset.kind)).toEqual(["agent", "job"]);
	});

	it("opens the child it was clicked on", () => {
		const onOpen = vi.fn();
		const host = mount(THREADS, onOpen);
		act(() => host.querySelectorAll("button")[1].click());
		expect(onOpen).toHaveBeenCalledWith(THREADS[1]);
	});
});
