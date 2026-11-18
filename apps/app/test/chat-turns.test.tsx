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

function chatDoc(doc: Record<string, unknown>) {
	offline.setQueryData(convexQuery(api.chats.get, { chatId: CHAT }).queryKey, {
		_id: CHAT,
		...doc,
	});
}

function count(text: string): number {
	return shown().split(text).length - 1;
}

const ai = (wireId: string, content: string) => ({
	type: "ai",
	wireId,
	content,
});

describe("which copy of a message the chat shows", () => {
	test("takes the stream's copy of a stored message while it runs", async () => {
		stored([
			{ type: "human", wireId: "h", content: "go now" },
			ai("a", "old words"),
		]);
		chatDoc({ status: "streaming" });
		await mount();
		await streamed(
			sse("values", {
				messages: [
					{ id: "h", type: "human", content: "go now" },
					{ id: "a", type: "ai", content: "new words" },
				],
			}),
		);
		expect(shown()).toContain("new words");
		expect(shown()).not.toContain("old words");
	});

	test("takes the stored copy once the turn is over", async () => {
		stored([
			{ type: "human", wireId: "h", content: "go now" },
			ai("a", "final words"),
		]);
		chatDoc({ status: "idle" });
		await mount();
		await streamed(
			sse("values", {
				messages: [
					{ id: "h", type: "human", content: "go now" },
					{ id: "a", type: "ai", content: "stale words" },
				],
			}),
			sse("status", { status: "idle" }),
		);
		expect(shown()).toContain("final words");
		expect(shown()).not.toContain("stale words");
	});
});

describe("the order the chat shows", () => {
	test("keeps what convex has not caught up on after the turn", async () => {
		stored([
			{ type: "human", wireId: "h", content: "go now" },
			ai("a", "first part"),
		]);
		chatDoc({ status: "idle" });
		await mount();
		await streamed(
			sse("values", {
				messages: [
					{ id: "h", type: "human", content: "go now" },
					{ id: "a", type: "ai", content: "first part" },
					{ id: "b", type: "ai", content: "second part" },
				],
			}),
		);
		expect(inOrder("go now", "first part", "second part")).toBe(true);
	});

	test("shows every interleaving of stored and streamed in the order written", async () => {
		let state = 7;
		const random = (below: number) => {
			state = (state * 1103515245 + 12345) % 2147483648;
			return state % below;
		};
		for (let run = 0; run < 25; run += 1) {
			const written = Array.from(
				{ length: 1 + random(8) },
				(_, i) => `word${String(i).padStart(2, "0")}x`,
			);
			const caught = random(written.length + 1);
			const human = { type: "human", wireId: "h", content: "go now" };
			stored([human, ...written.slice(0, caught).map((id) => ai(id, id))]);
			chatDoc({ status: random(2) === 0 ? "streaming" : "idle" });
			await mount();
			await streamed(
				sse("values", {
					messages: [
						{ id: "h", type: "human", content: "go now" },
						...written
							.filter((_, i) => i >= caught || random(2) === 0)
							.map((id) => ({ id, type: "ai", content: id })),
					],
				}),
			);
			expect(inOrder("go now", ...written)).toBe(true);
			for (const id of written) expect(count(id)).toBe(1);
		}
	});
});

describe("a sub-agent's conversation", () => {
	test("opens on the request its parent sent", async () => {
		stored([
			{
				type: "system",
				wireId: "ask",
				content: "summarise the upload",
				kwargs: { source: "agent:parent" },
			},
			ai("a", "on it"),
		]);
		await mount();
		expect(inOrder("agent parent", "on it")).toBe(true);
	});

	test("opens the conversation on the prompt it was spawned with", async () => {
		chatDoc({
			parentChatId: "parent",
			agent: { prompt: "you review uploads" },
		});
		stored([ai("a", "on it")]);
		await mount();
		expect(inOrder("you review uploads", "on it")).toBe(true);
	});

	test("opens on nothing in a chat no agent spawned", async () => {
		chatDoc({});
		stored([ai("a", "on it")]);
		await mount();
		expect(shown().startsWith("on it")).toBe(true);
	});
});

describe("a form the user ran from the input", () => {
	test.each([
		false,
		true,
	])("shows its output in the chat body when quiet is %s", async (quiet) => {
		stored([
			{ type: "human", wireId: "u", content: "(list 1 2 3)" },
			{
				type: "tool",
				wireId: "ran",
				content: "",
				kwargs: { display: "(1 2 3)", ...(quiet ? { quiet: true } : {}) },
			},
		]);
		await mount();
		expect(inOrder("(list 1 2 3)", "(1 2 3)")).toBe(true);
	});

	test("leaves out a quiet step the agent ran", async () => {
		stored([
			{ type: "human", wireId: "u", content: "(list 1 2 3)" },
			ai("c", ""),
			{
				type: "tool",
				wireId: "ran",
				content: "",
				kwargs: { display: "(9 9 9)", quiet: true },
			},
		]);
		await mount();
		expect(shown()).not.toContain("(9 9 9)");
	});
});

describe("activity a quiet step started", () => {
	const activity = (about: string) => ({
		type: "entry",
		wireId: "e1",
		kwargs: {
			kind: "activity",
			value: { id: "apify", kind: "mcp", label: "apify-run", state: "done" },
			about,
		},
	});

	test("is shown under the call that came before the quiet step", async () => {
		stored([
			{ type: "human", wireId: "u", content: "go now" },
			ai("a", "(first-step)"),
			{ type: "tool", wireId: "t1", content: "" },
			{ type: "tool", wireId: "q", content: "", kwargs: { quiet: true } },
			activity("q"),
			ai("b", "(second-step)"),
			{ type: "tool", wireId: "t2", content: "" },
		]);
		await mount();
		expect(inOrder("go now", "apify-run", "second-step")).toBe(true);
	});

	test("is shown after the text it followed, not above it", async () => {
		stored([
			{ type: "human", wireId: "u", content: "go now" },
			ai("a", "(first-step)"),
			{ type: "tool", wireId: "t1", content: "" },
			ai("b", "wrapping up"),
			{ type: "tool", wireId: "q", content: "", kwargs: { quiet: true } },
			activity("q"),
		]);
		await mount();
		expect(inOrder("wrapping up", "apify-run")).toBe(true);
	});
});
