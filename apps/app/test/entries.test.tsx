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
import { ChatProvider } from "../src/lib/chat.tsx";
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

const INTENT = {
	kind: "intent",
	value: {
		doing: "reading the docs",
		log: [{ text: "reading the docs", startedAt: 1, state: "running" }],
	},
};

const asked = (wireId: string, extra: Record<string, unknown> = {}) => ({
	type: "entry",
	wireId,
	kwargs: { kind: "asks", value: { open: [REQUEST] }, ...extra },
});

function count(text: string): number {
	return shown().split(text).length - 1;
}

describe("where the chat shows what a step recorded", () => {
	test("shows what a step recorded after the step, before the answer that follows", async () => {
		stored([
			{ type: "human", wireId: "h", content: "go now" },
			{ type: "ai", wireId: "s1", content: "(first-step)" },
			asked("e1"),
			{ type: "tool", wireId: "t1", content: "" },
			{ type: "ai", wireId: "a", content: "all done" },
		]);
		await mount();
		expect(inOrder("go now", "first-step", REQUEST.title, "all done")).toBe(
			true,
		);
		expect(count(REQUEST.title)).toBe(1);
	});

	test("shows what an answering step recorded after its answer", async () => {
		stored([
			{ type: "human", wireId: "h", content: "go now" },
			{ type: "ai", wireId: "a", content: "here it is" },
			{ type: "entry", wireId: "e1", kwargs: INTENT },
		]);
		await mount();
		expect(inOrder("here it is", "reading the docs")).toBe(true);
	});

	test("shows what a step recorded under that step, wherever the row sits", async () => {
		stored([
			{ type: "human", wireId: "h", content: "go now" },
			asked("e0", { about: "s2" }),
			{ type: "ai", wireId: "s1", content: "(first-step)" },
			{ type: "tool", wireId: "t1", content: "" },
			{ type: "ai", wireId: "s2", content: "(second-step)" },
			{ type: "tool", wireId: "t2", content: "" },
		]);
		await mount();
		expect(inOrder("first-step", "second-step", REQUEST.title)).toBe(true);
	});

	test("shows what a running step recorded before the step has a result", async () => {
		await mount();
		await streamed(
			sse("status", { status: "running" }),
			sse("values", {
				messages: [
					{ id: "h", type: "human", content: "go now" },
					{ id: "s1", type: "ai", content: "(first-step)" },
					{
						id: "e1",
						type: "entry",
						content: "",
						additional_kwargs: { ...INTENT, about: "s1" },
					},
				],
			}),
		);
		expect(inOrder("go now", "reading the docs")).toBe(true);
	});

	test("shows a sub-agent's held ask on the message that surfaced it", async () => {
		stored([
			{ type: "human", wireId: "h", content: "go now" },
			{
				type: "tool",
				wireId: "w",
				content: "waiting",
				kwargs: { thread: "c", holding: "x" },
			},
			{ type: "ai", wireId: "a", content: "all done" },
			asked("e1", { thread: "c", holding: "x" }),
		]);
		await mount();
		expect(inOrder(REQUEST.title, "all done")).toBe(true);
	});

	test("leaves out what the chat does not show", async () => {
		stored([
			{ type: "human", wireId: "h", content: "go now" },
			{
				type: "entry",
				wireId: "n",
				kwargs: { kind: "note", value: { text: "a private note" } },
			},
			{ type: "ai", wireId: "a", content: "all done" },
		]);
		await mount();
		expect(shown()).toContain("all done");
		expect(shown()).not.toContain("a private note");
	});
});
