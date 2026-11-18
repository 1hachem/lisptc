// @vitest-environment happy-dom

import { convexQuery } from "@convex-dev/react-query";
import { api } from "@repo/backend/api";
import type { Id } from "@repo/backend/dataModel";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getFunctionName } from "convex/server";
import {
	$createParagraphNode,
	$createTextNode,
	$getRoot,
	type LexicalEditor,
} from "lexical";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";

const world = vi.hoisted(() => ({
	mutations: new Map<string, (args: unknown) => Promise<unknown>>(),
	posted: [] as Record<string, unknown>[],
}));

vi.mock("@convex-dev/react-query", async (importOriginal) => ({
	...(await importOriginal<typeof import("@convex-dev/react-query")>()),
	useConvexMutation: (ref: Parameters<typeof getFunctionName>[0]) => {
		const name = getFunctionName(ref);
		const call = (args: unknown) =>
			(world.mutations.get(name) ?? (() => Promise.resolve(null)))(args);
		return Object.assign(call, { withOptimisticUpdate: () => call });
	},
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
vi.mock("../src/lib/appearance.tsx", () => ({
	useAppearance: () => ({
		theme: "dark",
		chooseTheme: () => {},
		openThemePicker: () => {},
		openFontPicker: () => {},
	}),
}));
vi.mock("../src/lib/fork-picker.tsx", () => ({
	useForkPicker: () => ({ openForkPicker: () => {} }),
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

import { Chat } from "../src/components/chat.tsx";
import { ChatComposer } from "../src/components/chat-composer.tsx";
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
	Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
	globalThis.ResizeObserver ??= class {
		observe() {}
		unobserve() {}
		disconnect() {}
	} as unknown as typeof ResizeObserver;
});

beforeEach(() => {
	world.mutations.clear();
	world.posted.length = 0;
	vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
		if (url === "/api/chat") {
			world.posted.push(JSON.parse(String(init?.body)).input);
			return Promise.resolve(
				Response.json({ accepted: true }, { status: 202 }),
			);
		}
		if (url === "https://upload.test")
			return Promise.resolve(Response.json({ storageId: "s1" }));
		if (!url.startsWith("/api/chat/watch"))
			return Promise.resolve(Response.json([]));
		return Promise.resolve(
			new Response(new ReadableStream(), {
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

async function mount(
	chatId: Id<"chats"> | null,
	composer: Parameters<typeof ChatComposer>[0] = {},
) {
	await act(async () => {
		root.render(
			<QueryClientProvider client={offline}>
				<UIProvider>
					<ChatProvider
						workspaceId={WORKSPACE}
						chatId={chatId}
						onOpened={() => {}}
					>
						<AgentProvider>
							<ChatView />
							<ChatComposer {...composer} />
						</AgentProvider>
					</ChatProvider>
				</UIProvider>
			</QueryClientProvider>,
		);
	});
}

async function mountChat(rows: Record<string, unknown>[]) {
	offline.setQueryData(
		convexQuery(api.messages.light, { chatId: CHAT }).queryKey,
		rows.map((row, seq) => ({ seq, _id: `row${seq}`, ...row })),
	);
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
							<Chat />
						</AgentProvider>
					</ChatProvider>
				</UIProvider>
			</QueryClientProvider>,
		);
	});
}

function editor(): LexicalEditor {
	const field = host.querySelector("[contenteditable]");
	const found = (field as { __lexicalEditor?: LexicalEditor } | null)
		?.__lexicalEditor;
	if (!found) throw new Error("no editor");
	return found;
}

function attach(file: File) {
	const input = host.querySelector<HTMLInputElement>('input[type="file"]');
	if (!input) throw new Error("no file input");
	Object.defineProperty(input, "files", { value: [file], configurable: true });
	act(() => {
		input.dispatchEvent(new Event("change", { bubbles: true }));
	});
}

async function settled() {
	await act(async () => {
		await new Promise((settle) => setTimeout(settle, 0));
	});
}

function storing() {
	world.mutations.set("files:uploadUrl", async () => "https://upload.test");
	world.mutations.set("files:add", async (args) => ({
		name: (args as { name: string }).name,
	}));
}

const ABOUT = { path: "knowledge/a.md", source: "# a" };

function typed(): string {
	return editor()
		.getEditorState()
		.read(() => $getRoot().getTextContent());
}

async function send(text: string) {
	act(() =>
		editor().update(
			() => {
				const paragraph = $createParagraphNode().append($createTextNode(text));
				$getRoot().clear().append(paragraph);
				paragraph.selectEnd();
			},
			{ discrete: true },
		),
	);
	await act(async () => {
		host.querySelector("[contenteditable]")?.dispatchEvent(
			new KeyboardEvent("keydown", {
				key: "Enter",
				bubbles: true,
				cancelable: true,
			}),
		);
		await new Promise((settle) => setTimeout(settle, 0));
	});
}

describe("sending from the chat", () => {
	it("says a first message was not sent when its chat cannot be opened, and keeps it", async () => {
		world.mutations.set("chats:draft", () =>
			Promise.reject(new Error("offline")),
		);
		await mount(null);
		await send("hello");
		expect(host.textContent).toContain("message not sent, try again");
		expect(typed()).toBe("hello");
		expect(world.posted).toEqual([]);
	});

	it("sends a message about a file that carries only attachments", async () => {
		storing();
		await mount(CHAT, { about: ABOUT });
		attach(new File(["%PDF"], "spec.pdf", { type: "application/pdf" }));
		await settled();
		await send("  ");
		expect(world.posted).toEqual([
			expect.objectContaining({
				message: expect.stringContaining("knowledge/a.md"),
				received: expect.objectContaining({
					attachments: [{ folder: "attachments", name: "spec.pdf" }],
				}),
			}),
		]);
	});

	it("sends nothing beside the text when no file was attached", async () => {
		await mount(CHAT);
		await send("hello there");
		expect(world.posted).toEqual([
			{ chatId: CHAT, id: expect.any(String), message: "hello there" },
		]);
	});

	it("discards the files it uploaded when the composer goes away unsent", async () => {
		storing();
		const discarded: string[] = [];
		world.mutations.set("files:discard", async (args) => {
			discarded.push((args as { name: string }).name);
		});
		await mount(CHAT);
		attach(new File(["a"], "a.txt"));
		await settled();
		attach(new File(["b"], "b.txt"));
		await settled();
		act(() => root.render(null));
		await settled();
		expect(discarded.sort()).toEqual(["a.txt", "b.txt"]);
	});

	it("puts the message being sent after what is stored, once", async () => {
		offline.setQueryData(
			convexQuery(api.messages.light, { chatId: CHAT }).queryKey,
			[
				{
					seq: 0,
					_id: "row0",
					type: "ai",
					wireId: "a",
					content: "earlier reply",
				},
			],
		);
		await mount(CHAT);
		await send("hello there");
		const text = host.textContent ?? "";
		expect(text).toContain("earlier reply");
		expect(text.indexOf("earlier reply")).toBeLessThan(
			text.indexOf("hello there"),
		);
		expect(text.split("hello there").length - 1).toBe(1);
	});

	it("sends nothing about a file when there is neither text nor a file", async () => {
		await mount(CHAT, { about: ABOUT });
		await send(" ");
		expect(world.posted).toEqual([]);
	});
});

const QUESTION = {
	id: "q1",
	prompt: "which one?",
	choices: ["Apple", "Banana", "Cherry"],
	multi: false,
};

const asking = (value: unknown) => [
	{ type: "human", wireId: "h", content: "help me pick" },
	{ type: "ai", wireId: "a", content: "(ask)" },
	{
		type: "entry",
		wireId: "e",
		kwargs: { kind: "question", value, about: "a" },
	},
	{ type: "tool", wireId: "t", content: "" },
];

const picking = () =>
	[...host.querySelectorAll("button")].some((b) =>
		b.textContent?.includes("Banana"),
	);

describe("the question the chat asks", () => {
	it("offers the choices of the question the turn last recorded, in place of the editor", async () => {
		await mountChat(asking(QUESTION));
		expect(host.textContent).toContain("which one?");
		expect(picking()).toBe(true);
		expect(host.querySelector("[contenteditable]")).toBeNull();
	});

	it("is closed once a human message follows it", async () => {
		await mountChat([
			...asking(QUESTION),
			{ type: "ai", wireId: "b", content: "pick one" },
			{ type: "human", wireId: "h2", content: "Banana" },
		]);
		expect(picking()).toBe(false);
		expect(host.querySelector("[contenteditable]")).not.toBeNull();
	});

	it("ignores a malformed question", async () => {
		await mountChat(asking({ id: "q" }));
		expect(host.querySelector("[contenteditable]")).not.toBeNull();
	});
});
