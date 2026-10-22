// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { TraceLines } from "../src/components/trace-view.tsx";
import type { ChatMessage } from "../src/lib/chat.tsx";
import { UIProvider } from "../src/lib/ui.tsx";

vi.mock("../src/lib/preferences.ts", () => ({
	usePreferences: () => ({}),
	usePutPreferences: () => () => {},
	useTraceLink: () => ({ traceLink: true, setTraceLink: () => {} }),
}));
vi.mock("../src/lib/prefs.ts", () => ({
	SIDEBAR_COOKIE: "ui.sidebar",
	PREFERENCES_COOKIE: "ui.panel",
	readBoolPref: (_name: string, fallback: boolean) => fallback,
	writeBoolPref: () => {},
}));
vi.mock("../src/lib/analytics.tsx", () => ({ reportIssue: vi.fn() }));
vi.mock("../src/lib/model-picker.tsx", () => ({
	useModelPicker: () => ({ openModelPicker: vi.fn() }),
}));
vi.mock("../src/lib/api.ts", () => ({ apiHeaders: async () => ({}) }));
vi.mock("../src/components/agent-avatar.tsx", () => ({
	AgentAvatar: () => null,
}));
vi.mock("../src/components/message-feedback.tsx", () => ({
	MessageFeedback: () => null,
}));

beforeAll(() => {
	(
		globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
	).IS_REACT_ACT_ENVIRONMENT = true;
	globalThis.ResizeObserver ??= class {
		observe() {}
		unobserve() {}
		disconnect() {}
	} as unknown as typeof ResizeObserver;
});

const roots: Root[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) act(() => root.unmount());
	document.body.replaceChildren();
});

const offline = new QueryClient({
	defaultOptions: { queries: { enabled: false } },
});

async function mount(messages: ChatMessage[]) {
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	roots.push(root);
	await act(async () => {
		root.render(
			<QueryClientProvider client={offline}>
				<UIProvider>
					<TraceLines messages={messages} />
				</UIProvider>
			</QueryClientProvider>,
		);
	});
	return host;
}

const approval = {
	id: "a1",
	title: "fs/write a",
	prompt: "write to a?",
	choices: [
		{ label: "Allow", accepts: true, answer: { action: "allow", values: {} } },
		{ label: "Deny", accepts: false, answer: { action: "deny", values: {} } },
	],
};

function tool(kwargs: Record<string, unknown>): ChatMessage {
	return {
		id: "t1",
		type: "tool",
		content: "",
		additional_kwargs: kwargs,
	} as ChatMessage;
}

describe("an ask in the trace", () => {
	it("reads as text with nothing to press", async () => {
		const host = await mount([
			{ id: "h1", type: "human", content: "write a" } as ChatMessage,
			tool({ asks: { open: [approval] } }),
		]);

		expect(host.textContent).toContain("write to a?");
		expect(host.textContent).toContain("choices: Allow · Deny");
		expect(host.textContent).toContain("not answered");
		const labels = [...host.querySelectorAll("button")].map(
			(button) => button.textContent,
		);
		expect(labels).not.toContain("Allow");
		expect(labels).not.toContain("Deny");
	});

	it("says what was answered", async () => {
		const host = await mount([
			tool({
				asks: {
					open: [approval],
					answered: { a1: { accepted: true, label: "Allowed" } },
				},
			}),
		]);

		expect(host.textContent).toContain("answered: Allowed");
	});

	it("shows the question the agent asked, with its choices as text", async () => {
		const host = await mount([
			tool({
				question: {
					id: "q1",
					prompt: "which one?",
					choices: ["A", "B"],
					multi: false,
				},
			}),
		]);

		expect(host.textContent).toContain("which one?");
		expect(host.textContent).toContain("pick one: A · B");
		const labels = [...host.querySelectorAll("button")].map(
			(button) => button.textContent,
		);
		expect(labels).not.toContain("A");
	});
});
