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
];

const rows = (host: HTMLElement) => [
	...host.querySelectorAll<HTMLButtonElement>("li button"),
];

describe("child threads", () => {
	it("is hidden when the chat spawned none", () => {
		expect(mount([]).childElementCount).toBe(0);
	});

	it("counts the children and shows a state for each", () => {
		const host = mount(THREADS);
		expect(host.textContent).toContain("3 threads");
		const buttons = rows(host);
		expect(buttons.map((b) => b.dataset.state)).toEqual([
			"running",
			"waiting",
			"errored",
		]);
		expect(buttons.map((b) => b.title)).toEqual(["running", "waiting", "boom"]);
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
		act(() => rows(host)[1].click());
		expect(onOpen).toHaveBeenCalledWith(THREADS[1]);
	});

	it("shows the latest children and expands to the earlier ones", () => {
		const host = mount([
			...THREADS,
			{ _id: "d", title: "" },
			{ _id: "e", title: "tester", status: "streaming" },
		]);
		expect(rows(host).map((b) => b.dataset.state)).toEqual([
			"errored",
			"idle",
			"running",
		]);
		expect(rows(host)[1].textContent).toContain("untitled");
		const more = host.querySelector<HTMLButtonElement>(
			"[data-child-threads=more]",
		);
		expect(more?.textContent).toBe("+2 earlier");
		act(() => more?.click());
		expect(rows(host)).toHaveLength(5);
		expect(host.querySelector("[data-child-threads=more]")).toBeNull();
	});

	it("collapses to a chip and opens again", () => {
		const host = mount(THREADS);
		act(() =>
			host
				.querySelector<HTMLButtonElement>("[data-child-threads=collapse]")
				?.click(),
		);
		expect(rows(host)).toHaveLength(0);
		const chip = host.querySelector<HTMLButtonElement>(
			"[data-child-threads=chip]",
		);
		expect(chip?.textContent).toBe("3/3");
		act(() => chip?.click());
		expect(rows(host)).toHaveLength(3);
	});
});
