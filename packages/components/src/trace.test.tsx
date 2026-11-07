// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, describe, expect, it } from "vitest";
import { Trace } from "./trace.tsx";
import type { ChatMessage } from "./trace-message.ts";

beforeAll(() => {
	(
		globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
	).IS_REACT_ACT_ENVIRONMENT = true;
});

let ids = 0;

const said = (content: string): ChatMessage => ({
	id: `m${++ids}`,
	type: "human",
	content,
});

const ran = (content: string): ChatMessage => ({
	id: `m${++ids}`,
	type: "ai",
	content,
});

const prompted = (text: string): ChatMessage => ({
	id: `m${++ids}`,
	type: "entry",
	content: "",
	additional_kwargs: { kind: "system-prompt", value: { text } },
});

async function mounted(messages: ChatMessage[]) {
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	await act(async () => {
		root.render(
			<Trace
				messages={messages}
				slots={{ line: (message) => String(message.content) }}
			/>,
		);
	});
	const button = (text: string) =>
		[...host.querySelectorAll<HTMLButtonElement>("button")].find((b) =>
			b.textContent?.includes(text),
		);
	return {
		text: () => host.textContent ?? "",
		prompts: () =>
			[...host.querySelectorAll("button")].filter((b) =>
				b.textContent?.includes("system prompt"),
			),
		async click(text: string) {
			await act(async () => {
				button(text)?.click();
			});
		},
	};
}

describe("the system prompt in a trace", () => {
	it("comes first, folded, ahead of the message that opened the turn", async () => {
		const trace = await mounted([
			said("hello"),
			prompted("be terse"),
			ran("(+ 1 2)"),
		]);

		const [prompt] = trace.prompts();
		expect(prompt?.getAttribute("aria-expanded")).toBe("false");
		expect(trace.text().indexOf("system prompt")).toBeLessThan(
			trace.text().indexOf("hello"),
		);
		expect(trace.text()).not.toContain("be terse");
	});

	it("unfolds to the full prompt", async () => {
		const trace = await mounted([said("hello"), prompted("be terse")]);

		await trace.click("system prompt");

		expect(trace.text()).toContain("be terse");
	});

	it("is hidden by the system filter", async () => {
		const trace = await mounted([said("hello"), prompted("be terse")]);

		await trace.click("system");

		expect(trace.prompts()).toHaveLength(0);
		expect(trace.text()).toContain("hello");
	});

	it("shows once while the prompt stays the same, and again when it changes", async () => {
		const same = await mounted([
			said("hello"),
			prompted("be terse"),
			ran("(+ 1 2)"),
			said("again"),
			prompted("be terse"),
			ran("(+ 2 2)"),
		]);
		const changed = await mounted([
			said("hello"),
			prompted("be terse"),
			ran("(+ 1 2)"),
			said("again"),
			prompted("be verbose"),
			ran("(+ 2 2)"),
		]);

		expect(same.prompts()).toHaveLength(1);
		expect(changed.prompts()).toHaveLength(2);
	});
});
