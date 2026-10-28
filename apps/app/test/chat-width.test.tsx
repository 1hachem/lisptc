// @vitest-environment happy-dom
import { convexQuery } from "@convex-dev/react-query";
import { api } from "@repo/backend/api";
import type { Id } from "@repo/backend/dataModel";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ChatView } from "../src/components/chat-view.tsx";
import { AgentProvider } from "../src/lib/agent.tsx";
import type { ChatMessage } from "../src/lib/chat.tsx";
import { UIProvider } from "../src/lib/ui.tsx";
import { sidewaysLeaks } from "./helpers.ts";

const session = vi.hoisted(() => ({
	messages: [] as unknown[],
	queued: [] as unknown[],
	withdraw: () => {},
	meta: {},
	error: undefined as string | undefined,
	isLoading: false,
	fresh: false,
	chatId: "c1",
	workspaceId: "w1",
	resume: () => {},
	fail: () => {},
}));

vi.mock("../src/lib/chat.tsx", async (importOriginal) => ({
	...(await importOriginal<typeof import("../src/lib/chat.tsx")>()),
	useChatSession: <U,>(selector: (state: typeof session) => U): U =>
		selector(session),
}));
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
vi.mock("../src/lib/analytics.tsx", () => ({
	reportIssue: vi.fn(),
	captureFeedback: vi.fn(),
}));
vi.mock("../src/lib/model-picker.tsx", () => ({
	useModelPicker: () => ({ openModelPicker: vi.fn() }),
}));
vi.mock("../src/lib/api.ts", () => ({ apiHeaders: async () => ({}) }));
vi.mock("../src/components/agent-avatar.tsx", () => ({
	AgentAvatar: () => null,
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

function storeView(viewId: string, node: unknown): { viewId: string } {
	offline.setQueryData(
		convexQuery(api.views.get, { chatId: "c1" as Id<"chats">, viewId })
			.queryKey,
		{ node, rev: 1 },
	);
	return { viewId };
}

async function mount() {
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	roots.push(root);
	await act(async () => {
		root.render(
			<QueryClientProvider client={offline}>
				<UIProvider>
					<AgentProvider>
						<ChatView />
					</AgentProvider>
				</UIProvider>
			</QueryClientProvider>,
		);
	});
	return host;
}

const long = "y".repeat(400);

const answer = (prose: string) => ({
	prose: [{ span: [0, prose.length] as [number, number], reason: "prose" }],
	meta: {
		at: "2026-10-22T10:00:00.000Z",
		durationMs: 1200,
		provider: "openrouter",
		model: `google/${long}`,
		steps: 2,
	},
});

const MARKDOWN = [
	long,
	`| ${long} | b |\n|---|---|\n| ${long} | ${long} |`,
	`\`\`\`\n${long}\n\`\`\``,
	`see https://example.com/${long} and \`${long}\``,
	`- ${long}\n  - ${long}`,
	`> ${long}`,
].join("\n\n");

const WIDE: ChatMessage[] = [
	{ id: "h1", type: "human", content: long },
	{
		id: "a1",
		type: "ai",
		content: `${long}\n(${long} "${long}")`,
		additional_kwargs: { reasoning_content: long },
	},
	{
		id: "t1",
		type: "tool",
		content: "",
		additional_kwargs: {
			intent: {
				doing: long,
				todos: [{ label: long, done: false }],
				progress: { done: 1, total: 2, label: long },
				log: [{ text: long, startedAt: 0, state: "running" }],
			},
			activity: [
				{ id: "z", kind: "mcp", label: long, detail: long, state: "started" },
			],
			ui: storeView("wide", {
				tag: "stack",
				props: {},
				children: [
					{ tag: "text", props: { text: long }, children: [] },
					{ tag: "markdown", props: { text: MARKDOWN }, children: [] },
					{
						tag: "table",
						props: { columns: [long, "b"], rows: [{ [long]: long, b: long }] },
						children: [],
					},
				],
			}),
			asks: {
				open: [
					{
						id: "k1",
						title: long,
						detail: long,
						prompt: long,
						choices: [
							{
								label: long,
								accepts: true,
								answer: { action: "x", values: {} },
							},
						],
					},
				],
			},
		},
	},
	{
		id: "a2",
		type: "ai",
		content: MARKDOWN,
		additional_kwargs: answer(MARKDOWN),
	},
];

const SIMPLE: ChatMessage[] = [
	{ id: "h1", type: "human", content: "hi" },
	{
		id: "a1",
		type: "ai",
		content: "Hello there.",
		additional_kwargs: answer("Hello there."),
	},
];

describe("the chat's width", () => {
	it.each([
		["a simple reply", SIMPLE],
		["a turn full of text wider than the pane", WIDE],
	])("keeps %s inside the chat, live and settled", async (_, messages) => {
		session.messages = messages;
		session.isLoading = true;
		const live = await mount();

		expect(sidewaysLeaks(live)).toEqual([]);

		session.isLoading = false;
		const settled = await mount();

		expect(settled.querySelector("[data-turn-foot]")).not.toBeNull();
		expect(sidewaysLeaks(settled)).toEqual([]);
	});

	it("scrolls a table wider than the pane inside its own box instead of squeezing its columns", async () => {
		const columns = Array.from({ length: 20 }, (_, i) => `column${i}`);
		const row = Object.fromEntries(columns.map((c) => [c, long]));
		session.messages = [
			{
				id: "t1",
				type: "tool",
				content: "",
				additional_kwargs: {
					ui: storeView("table", {
						tag: "table",
						props: { columns, rows: [row] },
						children: [],
					}),
				},
			},
		];
		session.isLoading = false;
		const host = await mount();

		const table = host.querySelector("table");
		expect(table?.classList.contains("w-max")).toBe(true);
		expect(table?.parentElement?.classList.contains("overflow-x-auto")).toBe(
			true,
		);
		for (const cell of host.querySelectorAll("th, td"))
			expect(cell.classList.contains("wrap-anywhere")).toBe(false);
		expect(sidewaysLeaks(host)).toEqual([]);
	});
});
