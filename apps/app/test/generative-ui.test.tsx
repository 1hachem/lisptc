// @vitest-environment happy-dom
import type { Id } from "@repo/backend/dataModel";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GenerativeUI } from "../src/components/generative-ui.tsx";
import { postUiAction } from "../src/lib/ui-action.ts";
import type { ViewNode } from "../src/lib/ui-node.ts";

const stored = vi.hoisted(() => ({ row: undefined as unknown }));

vi.mock("../src/lib/chat.tsx", () => ({
	useChatSession: <U,>(
		selector: (state: { chatId: string; send: () => void }) => U,
	): U => selector({ chatId: "c1", send: vi.fn() }),
}));
vi.mock("@tanstack/react-query", () => ({
	useQuery: () => ({ data: stored.row }),
}));
vi.mock("../src/lib/analytics.tsx", () => ({ reportIssue: vi.fn() }));
vi.mock("../src/lib/ui-action.ts", () => ({
	postUiAction: vi.fn(async () => ({})),
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
	stored.row = { node, rev: 1 };
	act(() =>
		root.render(<GenerativeUI chatId={"c1" as Id<"chats">} viewId="v1" />),
	);
}

describe("GenerativeUI", () => {
	it("draws nothing until the view is stored", () => {
		stored.row = null;
		act(() =>
			root.render(<GenerativeUI chatId={"c1" as Id<"chats">} viewId="v1" />),
		);
		expect(host.textContent).toBe("");
	});

	it("renders every widget a view can name", () => {
		render(
			view("stack", {}, [
				view("card", { title: "Report" }, [
					view("heading", { text: "Totals" }),
					view("text", { text: "plain words" }),
					view("link", { text: "", href: "https://example.com" }),
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
