// @vitest-environment happy-dom
import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, describe, expect, it } from "vitest";
import { type FiredMemory, firedMemories } from "./memories.ts";
import { MessageMemories } from "./message-memories.tsx";

beforeAll(() => {
	(
		globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
	).IS_REACT_ACT_ENVIRONMENT = true;
});

async function mounted(memories: FiredMemory[]) {
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	await act(async () => {
		root.render(
			<StrictMode>
				<MessageMemories memories={memories} />
			</StrictMode>,
		);
	});

	return {
		text: () => host.textContent ?? "",
		colorOf: (key: string) =>
			[...host.querySelectorAll("div[title]")]
				.find((row) => row.textContent?.includes(key))
				?.querySelector("[data-memory-dot]")?.className ?? "",
		stacked: () => host.querySelectorAll("button [data-memory-dot]").length,
		async toggle() {
			await act(async () => {
				host.querySelector<HTMLButtonElement>("button")?.click();
			});
		},
	};
}

describe("the recalled memories of a step", () => {
	it("renders nothing when none fired", async () => {
		const view = await mounted([]);
		expect(view.text()).toBe("");
	});

	it("counts them, then names them once opened", async () => {
		const view = await mounted([{ key: "navigate", body: "use the tool" }]);
		expect(view.text()).toContain("1 memory recalled");
		expect(view.text()).not.toContain("use the tool");

		await view.toggle();
		expect(view.text()).toContain("navigate — use the tool");
	});

	it("colors each one by the kind of event it fires on", async () => {
		const view = await mounted([
			{ key: "oops", body: "a lesson", on: "error" },
			{ key: "plain", body: "a fact" },
			{ key: "odd", body: "unknown", on: "someday" },
		]);
		await view.toggle();

		expect(view.colorOf("oops")).toContain("bg-red");
		expect(view.colorOf("plain")).toContain("bg-dim");
		expect(view.colorOf("odd")).toContain("bg-dim");
	});

	it("stacks a circle per memory, and counts the ones past the stack", async () => {
		const view = await mounted(
			Array.from({ length: 7 }, (_, i) => ({ key: `m${i}`, body: "" })),
		);

		expect(view.stacked()).toBe(5);
		expect(view.text()).toContain("+2");
	});

	it("pluralises the count", async () => {
		const view = await mounted([
			{ key: "a", body: "one" },
			{ key: "b", body: "two" },
		]);
		expect(view.text()).toContain("2 memories recalled");
	});
});

describe("reading memories off an annotation", () => {
	it("keeps the ones that carry a key", () => {
		expect(
			firedMemories([
				{ key: "a", body: "one" },
				{ body: "no key" },
				{ key: "b" },
				{ key: "c", body: "three", on: "error" },
				{ key: "d", body: "four", on: 7 },
				"not an object",
				null,
			]),
		).toEqual([
			{ key: "a", body: "one" },
			{ key: "b", body: "" },
			{ key: "c", body: "three", on: "error" },
			{ key: "d", body: "four" },
		]);
	});

	it("reads nothing out of a lane that is not a list", () => {
		expect(firedMemories(undefined)).toEqual([]);
		expect(firedMemories({ key: "a" })).toEqual([]);
	});
});
