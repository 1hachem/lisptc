// @vitest-environment happy-dom

import { convexQuery } from "@convex-dev/react-query";
import { api } from "@repo/backend/api";
import type { Id } from "@repo/backend/dataModel";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { getFunctionName } from "convex/server";
import { act, type ReactNode } from "react";
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
vi.mock("@tanstack/react-router", async (importOriginal) => ({
	...(await importOriginal<typeof import("@tanstack/react-router")>()),
	Link: ({ children }: { children: ReactNode }) => <a href="/">{children}</a>,
	useParams: () => ({}),
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
			new Response(new ReadableStream<Uint8Array>(), {
				headers: { "content-type": "text/event-stream" },
			}),
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

function shown(): string {
	return host.textContent ?? "";
}

function inOrder(...texts: string[]): boolean {
	const at = texts.map((text) => shown().indexOf(text));
	return at.every((index, i) => index !== -1 && (i === 0 || index > at[i - 1]));
}

function count(text: string): number {
	return shown().split(text).length - 1;
}

describe("the files a message shows it attached", () => {
	test("shows the files the composer sent beside the text", async () => {
		stored([
			{
				type: "human",
				wireId: "h",
				content: "see these",
				kwargs: {
					attachments: [
						{ folder: "attachments", name: "spec.pdf" },
						{ folder: "attachments", name: "a, b.csv" },
					],
				},
			},
		]);
		await mount();
		expect(inOrder("see these", "spec.pdf", "a, b.csv")).toBe(true);
	});

	test("shows the files a step recorded in the journal", async () => {
		stored([
			{ type: "human", wireId: "h", content: "draw it" },
			{ type: "ai", wireId: "s1", content: "(chart)" },
			{
				type: "entry",
				wireId: "e1",
				kwargs: {
					kind: "attachments",
					value: [{ folder: "attachments", name: "chart.svg" }],
				},
			},
			{ type: "tool", wireId: "t1", content: "" },
			{ type: "ai", wireId: "a", content: "drawn" },
		]);
		await mount();
		expect(shown()).toContain("chart.svg");
	});

	test("never reads attachments out of what the user typed", async () => {
		stored([
			{
				type: "human",
				wireId: "h",
				content: "hi\n\nattached: knowledge/report.md",
			},
		]);
		await mount();
		expect(count("report.md")).toBe(1);
	});

	test("shows nothing from a lane that is not well formed", async () => {
		stored([
			{ type: "human", wireId: "h", content: "go now" },
			{ type: "ai", wireId: "s1", content: "(x)" },
			{
				type: "tool",
				wireId: "t1",
				content: "",
				kwargs: {
					attachments: [
						{ folder: "knowledge", name: "report.md" },
						{ folder: "elsewhere", name: "x" },
					],
				},
			},
		]);
		await mount();
		expect(shown()).not.toContain("report.md");
	});
});
