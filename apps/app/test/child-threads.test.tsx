// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
	type ChildThread,
	ChildThreadStrip,
} from "../src/components/child-threads.tsx";

vi.mock("../src/lib/chat.tsx", () => ({
	stopChat: vi.fn(),
	useChatSession: vi.fn(),
}));

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

function mount(threads: ChildThread[]) {
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	roots.push(root);
	act(() =>
		root.render(
			<ChildThreadStrip
				threads={threads}
				onOpen={() => {}}
				onStop={() => {}}
				onStopAll={() => {}}
			/>,
		),
	);
	return host;
}

const control = (host: HTMLElement, name: string) =>
	host.querySelector<HTMLButtonElement>(`[data-child-threads=${name}]`);

const THREADS: ChildThread[] = [
	{ _id: "a", title: "researcher", status: "streaming" },
	{ _id: "b", title: "reviewer", status: "waiting" },
	{ _id: "c", title: "coder", status: "errored", failure: "boom" },
];

const labels = (host: HTMLElement) =>
	[...host.querySelectorAll("button")].map(
		(b) => b.getAttribute("aria-label") ?? "",
	);

const rows = (host: HTMLElement) => [
	...host.querySelectorAll<HTMLButtonElement>("li button[data-state]"),
];

describe("child threads", () => {
	it("is hidden when the chat spawned none", () => {
		const host = mount([]);
		expect(host.textContent).toBe("");
		expect(host.querySelectorAll("button")).toHaveLength(0);
	});

	it("offers no way to delete a child", () => {
		const host = mount(THREADS);
		expect(control(host, "clear")).toBeNull();
		expect(control(host, "clear-all")).toBeNull();
	});

	it("shows the latest children and expands to the earlier ones", () => {
		const host = mount([
			...THREADS,
			{ _id: "d", title: "", lastStartedAt: 1 },
			{ _id: "e", title: "tester", status: "streaming" },
		]);
		expect(rows(host).map((b) => b.title)).toEqual(["boom", "done", "running"]);
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
		expect(chip?.textContent).toBe("2/3");
		act(() => chip?.click());
		expect(rows(host)).toHaveLength(3);
	});

	it("offers a stop on each active child and none on a settled one", () => {
		const host = mount(THREADS);
		expect(labels(host).filter((label) => label.startsWith("stop "))).toEqual([
			"stop researcher",
			"stop reviewer",
		]);
	});

	it("tells a finished child from a stopped or failed one", () => {
		const host = mount([
			{ _id: "d", title: "done", lastStartedAt: 1 },
			{ _id: "s", title: "halted", status: "stopped" },
			{ _id: "e", title: "broke", status: "errored", failure: "boom" },
		]);
		expect(rows(host).map((b) => b.title)).toEqual(["done", "stopped", "boom"]);
	});

	it("marks a child that never ran a turn as idle, apart from a finished one", () => {
		const host = mount([
			{ _id: "i", title: "spawned" },
			{ _id: "d", title: "done", lastStartedAt: 1 },
		]);
		expect(rows(host).map((b) => b.title)).toEqual(["idle", "done"]);
		expect(control(host, "stop")).toBeNull();
	});

	it("offers no stop at all once everything settled", () => {
		const host = mount([
			{ _id: "d", title: "done" },
			{ _id: "s", title: "halted", status: "stopped" },
		]);
		expect(control(host, "stop-all")).toBeNull();
		expect(control(host, "stop")).toBeNull();
		expect(
			host.querySelector<HTMLButtonElement>("[data-child-threads=collapse]")
				?.textContent,
		).not.toContain("active");
	});
});
