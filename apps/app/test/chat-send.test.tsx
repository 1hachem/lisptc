// @vitest-environment happy-dom

import type { Id } from "@repo/backend/dataModel";
import { getFunctionName } from "convex/server";
import { act } from "react";
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
	submit: vi.fn(),
	reportIssue: vi.fn(),
}));

vi.mock("@convex-dev/react-query", () => ({
	convexQuery: () => ({ queryKey: [], queryFn: () => undefined }),
	useConvexMutation: (ref: Parameters<typeof getFunctionName>[0]) => {
		const name = getFunctionName(ref);
		const call = (args: unknown) =>
			(world.mutations.get(name) ?? (() => Promise.resolve(null)))(args);
		return Object.assign(call, { withOptimisticUpdate: () => call });
	},
}));
vi.mock("@tanstack/react-query", () => ({
	useQuery: () => ({ data: undefined }),
}));
vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => () => Promise.resolve(),
}));
vi.mock("@langchain/langgraph-sdk/react", () => ({
	FetchStreamTransport: class {},
	useStream: () => ({
		messages: [],
		isLoading: false,
		error: undefined,
		submit: world.submit,
		stop: vi.fn(),
	}),
}));
vi.mock("../src/lib/analytics.tsx", () => ({
	reportIssue: world.reportIssue,
}));
vi.mock("../src/lib/api.ts", () => ({ apiHeaders: async () => ({}) }));

import {
	ChatProvider,
	type ChatStore,
	useChatStore,
} from "../src/lib/chat.tsx";

const WORKSPACE = "w1" as Id<"workspaces">;
const CHAT = "c1" as Id<"chats">;

let host: HTMLElement;
let root: Root;
let store: ChatStore | null = null;

function Grab() {
	store = useChatStore();
	return null;
}

function mount(chatId: Id<"chats"> | null): ChatStore {
	act(() =>
		root.render(
			<ChatProvider workspaceId={WORKSPACE} chatId={chatId}>
				<Grab />
			</ChatProvider>,
		),
	);
	if (!store) throw new Error("no chat store");
	return store;
}

beforeAll(() => {
	(
		globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
	).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
	world.mutations.clear();
	world.submit.mockReset();
	world.reportIssue.mockReset();
	host = document.createElement("div");
	document.body.append(host);
	root = createRoot(host);
});

afterEach(() => {
	act(() => root.unmount());
	host.remove();
	store = null;
});

describe("sending from the chat", () => {
	it("says a first message was not sent when its chat cannot be opened", async () => {
		world.mutations.set("chats:draft", () =>
			Promise.reject(new Error("offline")),
		);
		const chat = mount(null);
		let sent: boolean | undefined;
		await act(async () => {
			sent = await chat.getState().send("hello");
		});
		expect(sent).toBe(false);
		expect(world.submit).not.toHaveBeenCalled();
		expect(world.reportIssue).toHaveBeenCalledWith(expect.any(Error), {
			$exception_source: "chat send",
		});
		expect(chat.getState().error).toBe("message not sent, try again");
	});

	it("sends a message about a file that carries only attachments", async () => {
		const chat = mount(CHAT);
		const annotations = {
			attachments: [{ folder: "attachments", name: "spec.pdf" }],
		};
		let sent: boolean | undefined;
		await act(async () => {
			sent = await chat
				.getState()
				.sendAbout(
					{ path: "knowledge/a.md", source: "# a" },
					"  ",
					annotations,
				);
		});
		expect(sent).toBe(true);
		expect(world.submit).toHaveBeenCalledWith(
			expect.objectContaining({
				chatId: CHAT,
				annotations,
				message: expect.stringContaining("knowledge/a.md"),
			}),
			expect.anything(),
		);
	});

	it("sends nothing about a file when there is neither text nor a file", async () => {
		const chat = mount(CHAT);
		await act(async () => {
			await chat
				.getState()
				.sendAbout({ path: "knowledge/a.md", source: "# a" }, " ");
		});
		expect(world.submit).not.toHaveBeenCalled();
	});
});
