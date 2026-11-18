// @vitest-environment happy-dom

import type { FiredMemory } from "@repo/journal-catalog/memory";
import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, describe, expect, it } from "vitest";
import { MessageMemories } from "./message-memories.tsx";

beforeAll(() => {
	(
		globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
	).IS_REACT_ACT_ENVIRONMENT = true;
});

async function mounted(memories: FiredMemory[], onOpen?: () => void) {
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	await act(async () => {
		root.render(
			<StrictMode>
				<MessageMemories memories={memories} onOpen={onOpen} />
			</StrictMode>,
		);
	});

	return {
		text: () => host.textContent ?? "",
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

	it("unfolds the memories on a click, unless the click opens the trace instead", async () => {
		const memories = [{ key: "navigate", body: "use the tool" }];
		const folding = await mounted(memories);
		await folding.toggle();
		expect(folding.text()).toContain("use the tool");

		const tracing = await mounted(memories, () => {});
		await tracing.toggle();
		expect(tracing.text()).toContain("1 memory recalled");
		expect(tracing.text()).not.toContain("use the tool");
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
