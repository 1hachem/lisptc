// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ChatView } from "../src/components/chat-view.tsx";
import { TraceLines } from "../src/components/trace-view.tsx";
import { CHANNELS } from "../src/lib/channels.ts";
import { UIProvider } from "../src/lib/ui.tsx";

const NOTE = "I approved (fs/write a). Carry on.";

const session = vi.hoisted(() => ({
	messages: [
		{ id: "h1", type: "human", content: "write a" },
		{
			id: "s1",
			type: "system",
			content: "I approved (fs/write a). Carry on.",
			additional_kwargs: { source: "permissions/decide" },
		},
	],
	meta: {},
	error: undefined,
	isLoading: false,
	queued: [] as unknown[],
}));

vi.mock("../src/lib/chat.tsx", async (importOriginal) => ({
	...(await importOriginal<typeof import("../src/lib/chat.tsx")>()),
	useChatSession: <U,>(selector: (state: typeof session) => U): U =>
		selector(session),
}));
const stored = vi.hoisted(() => {
	const listeners = new Set<() => void>();
	let value: Record<string, unknown> = {};
	return {
		get: () => value,
		put: (change: typeof value) => {
			value = { ...value, ...change };
			for (const listener of listeners) listener();
		},
		subscribe: (listener: () => void) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		reset: () => {
			value = {};
		},
	};
});

vi.mock("../src/lib/preferences.ts", async () => {
	const { useSyncExternalStore } = await import("react");
	return {
		usePreferences: () =>
			useSyncExternalStore(stored.subscribe, stored.get, stored.get),
		usePutPreferences: () => stored.put,
		useTraceLink: () => ({ traceLink: true, setTraceLink: () => {} }),
	};
});
const prefs = vi.hoisted(() => new Map<string, boolean>());

vi.mock("../src/lib/prefs.ts", () => ({
	SIDEBAR_COOKIE: "ui.sidebar",
	PREFERENCES_COOKIE: "ui.panel",
	readBoolPref: (name: string, fallback: boolean) =>
		prefs.get(name) ?? fallback,
	writeBoolPref: (name: string, value: boolean) => {
		prefs.set(name, value);
	},
}));
vi.mock("../src/lib/analytics.tsx", () => ({ reportIssue: vi.fn() }));
vi.mock("../src/lib/model-picker.tsx", () => ({
	useModelPicker: () => ({ openModelPicker: vi.fn() }),
}));
vi.mock("../src/lib/api.ts", () => ({
	apiHeaders: async () => ({}),
}));
vi.mock("../src/components/agent-avatar.tsx", () => ({
	AgentAvatar: () => null,
}));
vi.mock("../src/components/steer-queue.tsx", () => ({
	SteerQueue: () => null,
}));
vi.mock("../src/components/message-feedback.tsx", () => ({
	MessageFeedback: () => null,
}));
vi.mock("../src/components/user-line.tsx", () => ({
	UserLine: ({ text }: { text: string }) => <div data-user-line>{text}</div>,
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
	prefs.clear();
	stored.reset();
});

const offline = new QueryClient({
	defaultOptions: { queries: { enabled: false } },
});

async function mount(view: React.ReactNode = <ChatView />) {
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	roots.push(root);
	await act(async () => {
		root.render(
			<QueryClientProvider client={offline}>
				<UIProvider>{view}</UIProvider>
			</QueryClientProvider>,
		);
	});
	return host;
}

describe("the system channel", () => {
	it("is a channel the trace toggles", () => {
		expect(CHANNELS.find((c) => c.id === "system")).toMatchObject({
			label: "system",
		});
	});

	it("keeps what the system told the agent out of the chat", async () => {
		const host = await mount();
		expect(host.textContent).toContain("write a");
		expect(host.textContent).not.toContain(NOTE);
	});

	it("draws what the system told the agent in the trace, and never as the user's words", async () => {
		const host = await mount(<TraceLines messages={session.messages} />);

		expect(host.textContent).toContain(NOTE);
		const userLines = [...host.querySelectorAll("[data-user-line]")].map(
			(line) => line.textContent,
		);
		expect(userLines).toEqual(["write a"]);
	});
});
