// @vitest-environment happy-dom

import { convexQuery } from "@convex-dev/react-query";
import { api } from "@repo/backend/api";
import type { Id } from "@repo/backend/dataModel";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { getFunctionName } from "convex/server";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
	vi,
} from "vitest";

vi.mock("@convex-dev/react-query", async (importOriginal) => ({
	...(await importOriginal<typeof import("@convex-dev/react-query")>()),
	useConvexMutation: (_ref: Parameters<typeof getFunctionName>[0]) =>
		Object.assign(() => Promise.resolve(null), {
			withOptimisticUpdate: () => () => Promise.resolve(null),
		}),
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
	reportIssue: () => {},
	captureFeedback: () => {},
}));
vi.mock("../src/lib/model-picker.tsx", () => ({
	useModelPicker: () => ({ openModelPicker: () => {} }),
}));
vi.mock("../src/lib/api.ts", () => ({ apiHeaders: async () => ({}) }));
vi.mock("../src/components/agent-avatar.tsx", () => ({
	AgentAvatar: () => null,
}));

import { ChatView } from "../src/components/chat-view.tsx";
import { AgentProvider } from "../src/lib/agent.tsx";
import { type ChatMessage, ChatProvider } from "../src/lib/chat.tsx";
import { UIProvider } from "../src/lib/ui.tsx";

const WORKSPACE = "w1" as Id<"workspaces">;
const CHAT = "c1" as Id<"chats">;

let watch: ReadableStreamDefaultController<Uint8Array>;
let root: Root;
let host: HTMLElement;
let offline: QueryClient;

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

beforeEach(() => {
	vi.stubGlobal("fetch", (url: string) => {
		if (!url.startsWith("/api/chat/watch"))
			return Promise.resolve(Response.json([]));
		return Promise.resolve(
			new Response(
				new ReadableStream<Uint8Array>({
					start: (controller) => {
						watch = controller;
					},
				}),
				{ headers: { "content-type": "text/event-stream" } },
			),
		);
	});
	offline = new QueryClient({
		defaultOptions: {
			queries: { queryFn: () => new Promise(() => {}), staleTime: Infinity },
		},
	});
	host = document.createElement("div");
	document.body.append(host);
	root = createRoot(host);
});

afterEach(() => {
	act(() => root.unmount());
	host.remove();
	vi.unstubAllGlobals();
});

function stored(rows: Record<string, unknown>[]) {
	offline.setQueryData(
		convexQuery(api.messages.light, { chatId: CHAT }).queryKey,
		rows.map((row, seq) => ({ seq, _id: `row${seq}`, ...row })),
	);
}

async function mount() {
	await act(async () => {
		root.render(
			<QueryClientProvider client={offline}>
				<UIProvider>
					<ChatProvider
						workspaceId={WORKSPACE}
						chatId={CHAT}
						onOpened={() => {}}
					>
						<AgentProvider>
							<ChatView />
						</AgentProvider>
					</ChatProvider>
				</UIProvider>
			</QueryClientProvider>,
		);
	});
}

function sse(event: string, data: unknown): string {
	return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

async function streamed(...chunks: string[]) {
	const bytes = new TextEncoder();
	for (const chunk of chunks)
		await act(async () => {
			watch.enqueue(bytes.encode(chunk));
			await new Promise((settle) => setTimeout(settle, 0));
		});
}

function shown(): string {
	return host.textContent ?? "";
}

function inOrder(...texts: string[]): boolean {
	const at = texts.map((text) => shown().indexOf(text));
	return at.every((index, i) => index !== -1 && (i === 0 || index > at[i - 1]));
}

const human: ChatMessage = { id: "h", type: "human", content: "hello there" };

const REQUEST = {
	id: "r1",
	title: "(fs/write report.md)",
	prompt: "This call needs your approval.",
	choices: [
		{
			label: "Allow once",
			done: "Allowed",
			accepts: true,
			answer: { action: "permissions/decide", values: { id: "r1" } },
		},
	],
};

const ask: ChatMessage = {
	id: "ask",
	type: "tool",
	content: "",
	entries: [{ id: "e1", kind: "asks", value: { open: [REQUEST] } }],
};

describe("what the watch stream shows in the chat", () => {
	test("reads events that arrive one character at a time", async () => {
		await mount();
		await streamed(...sse("values", { messages: [human] }).split(""));
		expect(shown()).toContain("hello there");
	});

	test("follows a turn it did not start through its statuses", async () => {
		await mount();
		await streamed(
			sse("status", { status: "idle" }),
			sse("status", { status: "running" }),
			sse("values", { messages: [human] }),
		);
		expect(shown()).toContain("hello there");
	});

	test("grows the reply from its deltas", async () => {
		await mount();
		await streamed(
			sse("values", { messages: [human] }),
			sse("messages", [{ id: "a", type: "ai", content: "the answer " }, {}]),
			sse("messages", [{ id: "a", type: "ai", content: "is four" }, {}]),
		);
		expect(shown()).toContain("the answer is four");
	});

	test("never places a relayed message above what the turn carries", async () => {
		await mount();
		await streamed(
			sse("values", { messages: [human] }),
			sse("relayed", ask),
			sse("values", {
				messages: [human, { id: "s", type: "ai", content: "working on it" }],
			}),
		);
		expect(inOrder("hello there", "working on it", REQUEST.title)).toBe(true);
	});

	test("shows a relayed ask as stored once its answer is written there", async () => {
		stored([
			{ type: "human", wireId: "h", content: "hello there" },
			{ type: "tool", wireId: "ask", content: "" },
			{
				type: "entry",
				wireId: "e1",
				kwargs: { kind: "asks", value: { open: [REQUEST] }, about: "ask" },
			},
			{
				type: "entry",
				wireId: "e2",
				kwargs: {
					kind: "asks",
					value: { answered: { r1: { accepted: true, label: "Allowed" } } },
					about: "ask",
				},
			},
		]);
		await mount();
		await streamed(
			sse("status", { status: "running" }),
			sse("values", { messages: [human] }),
			sse("relayed", ask),
		);
		expect(shown()).toContain("Allowed");
	});

	test("shows the failure an errored thread reports", async () => {
		await mount();
		await streamed(sse("status", { status: "errored", failure: "boom" }));
		expect(shown()).toContain("boom");
	});
});
