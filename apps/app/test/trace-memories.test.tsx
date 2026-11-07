import type { ChatMessage } from "@repo/components";
// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { TraceLines } from "../src/components/trace-view.tsx";
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
					<TraceLines messages={messages} turn="t1" />
				</UIProvider>
			</QueryClientProvider>,
		);
	});
	return host;
}

const entry = (id: string, kind: string, value: unknown) =>
	({
		id,
		type: "entry",
		content: "",
		additional_kwargs: { kind, value },
	}) as ChatMessage;

const step = (...entries: ChatMessage[]): ChatMessage[] => [
	{ id: "h1", type: "human", content: "open my browser" } as ChatMessage,
	...entries,
	{ id: "a1", type: "ai", content: "(open)" } as ChatMessage,
	{ id: "t1", type: "tool", content: "" } as ChatMessage,
];

describe("memories in the trace", () => {
	it("shows what one recognition fired as a single row", async () => {
		const host = await mount(
			step(
				entry("j1", "recognized", {
					message: "open my browser",
					scores: { "browser work": 0.9 },
					fired: [
						{ key: "browser/local", body: "load it locally", on: "when" },
						{ key: "browser/flags", body: "pass :quiet t" },
						{ key: "browser/tabs", body: "one tab per page" },
					],
				}),
			),
		);

		expect(host.textContent).toContain("3 memories recalled");
		expect(host.textContent).not.toContain("1 memory recalled");
	});

	it("shows a memory another trigger fired on a row of its own", async () => {
		const host = await mount(
			step(entry("m1", "memory", { key: "deploy/notes", body: "use task" })),
		);

		expect(host.textContent).toContain("1 memory recalled");
	});

	it("shows nothing for a recognition that fired no memory", async () => {
		const host = await mount(
			step(
				entry("j1", "recognized", {
					message: "open my browser",
					scores: { "browser work": 0.1 },
				}),
			),
		);

		expect(host.textContent).not.toContain("recalled");
	});
});
