// @vitest-environment happy-dom
import type { ViewNode } from "@repo/interpreter/annotations";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GenerativeUI } from "../src/components/generative-ui.tsx";
import { postUiAction } from "../src/lib/ui-action.ts";

vi.mock("../src/lib/chat.tsx", () => ({
	useChatSession: <U,>(
		selector: (state: { chatId: string; send: () => void }) => U,
	): U => selector({ chatId: "c1", send: vi.fn() }),
}));
vi.mock("../src/lib/analytics.tsx", () => ({ reportIssue: vi.fn() }));
vi.mock("../src/lib/ui-action.ts", () => ({
	postUiAction: vi.fn(async () => ({ live: true, response: {} })),
}));

const view = (
	tag: string,
	props: ViewNode["props"] = {},
	children: ViewNode[] = [],
): ViewNode => ({ tag, props, children });

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
	host = document.createElement("div");
	document.body.append(host);
	root = createRoot(host);
});

afterEach(() => {
	act(() => root.unmount());
	host.remove();
	vi.mocked(postUiAction).mockClear();
});

function render(node: ViewNode) {
	act(() => root.render(<GenerativeUI node={node} />));
}

describe("GenerativeUI", () => {
	it("renders every widget a view can name", () => {
		render(
			view("stack", {}, [
				view("card", { title: "Report" }, [
					view("heading", { text: "Totals" }),
					view("text", { text: "plain words" }),
					view("link", { href: "https://example.com" }),
					view("badge", { text: "ok", tone: "ok" }),
					view("kpi", { label: "users", value: "42", hint: "this week" }),
				]),
				view("row", {}, [
					view("input", { name: "q", label: "query", value: "hi" }),
					view("select", { name: "pick", options: ["a", "b"] }),
					view("checkbox", { name: "on", label: "enabled", checked: true }),
				]),
				view("table", { columns: ["k"], rows: [{ k: "v" }] }),
			]),
		);
		const shown = host.textContent;
		for (const part of [
			"Report",
			"Totals",
			"plain words",
			"https://example.com",
			"ok",
			"users",
			"42",
			"this week",
			"query",
			"enabled",
			"v",
		])
			expect(shown).toContain(part);
		expect(host.querySelector("input[name=q]")).not.toBeNull();
		expect(host.querySelectorAll("select option")).toHaveLength(2);
		expect(
			host.querySelector<HTMLInputElement>("input[name=on]")?.checked,
		).toBe(true);
		expect(host.querySelector("span.border-green\\/50")?.textContent).toBe(
			"ok",
		);
	});

	it("names a widget it does not know", () => {
		render(view("toString"));
		expect(host.textContent).toContain("unknown widget: toString");
	});

	it("leaves out a field label the view does not give", () => {
		render(view("input", { name: "q" }));
		expect(host.querySelector("label span")).toBeNull();
	});

	it("fires a button's action with the values of its form", async () => {
		render(
			view("form", { action: "save", submit: "go" }, [
				view("input", { name: "q", value: "hi" }),
				view("button", { action: "preview", label: "look" }),
			]),
		);
		const look = [...host.querySelectorAll("button")].find(
			(button) => button.textContent === "look",
		);
		await act(async () => look?.click());
		expect(postUiAction).toHaveBeenCalledWith("c1", "preview", { q: "hi" });
	});
});
