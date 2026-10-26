// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ChatView } from "../src/components/chat-view.tsx";
import { TraceLines } from "../src/components/trace-view.tsx";
import { CallTimeline } from "../src/components/turn-intent.tsx";
import type { ChatMessage } from "../src/lib/chat.tsx";
import { traceOpen } from "../src/lib/panel-ops.ts";
import { SideTraceProvider } from "../src/lib/side-trace.tsx";
import { TraceSourceProvider } from "../src/lib/trace-source.tsx";
import { groupTurns, shapeTurn } from "../src/lib/turn-groups.ts";
import { formatElapsed, turnTimeline } from "../src/lib/turn-timeline.ts";
import { UIProvider } from "../src/lib/ui.tsx";

const PROSE = "Here is your chart.";

const MESSAGES: ChatMessage[] = [
	{ id: "h1", type: "human", content: "make a chart" },
	{ id: "a1", type: "ai", content: "(draw-chart)" },
	{
		id: "t1",
		type: "tool",
		content: '{"source":"lisp-repl","output":"MODEL-SAW"}',
		additional_kwargs: {
			display: "drawn for you",
			results: ["RESULT-VALUE"],
			ui: { tag: "text", props: {}, children: [] },
			intent: {
				doing: "drawing the chart",
				todos: [
					{ label: "fetch rows", done: true },
					{ label: "draw", done: false },
				],
			},
		},
	},
	{
		id: "a2",
		type: "ai",
		content: PROSE,
		additional_kwargs: {
			prose: [{ span: [0, PROSE.length], reason: "prose" }],
		},
	},
];

const session = vi.hoisted(() => ({
	messages: [] as unknown[],
	meta: {},
	error: undefined as string | undefined,
	isLoading: false,
	chatId: "c1",
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
		useTraceLink: () => ({
			traceLink:
				useSyncExternalStore(stored.subscribe, stored.get, stored.get)
					.traceLink !== false,
			setTraceLink: (on: boolean) => stored.put({ traceLink: on }),
		}),
	};
});

const panels = vi.hoisted(() => ({ apply: vi.fn() }));

vi.mock("../src/lib/panels.tsx", () => ({
	usePanels: () => ({ apply: panels.apply }),
}));
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

vi.mock("../src/components/generative-ui.tsx", () => ({
	GenerativeUI: () => <div data-ui>drawn ui</div>,
}));
vi.mock("../src/components/ask-card.tsx", () => ({ AskCard: () => null }));

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
	session.isLoading = false;
	session.error = undefined;
	panels.apply.mockClear();
});

const offline = new QueryClient({
	defaultOptions: { queries: { enabled: false } },
});

async function mount(view: React.ReactNode) {
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

describe("a chat drawn by turn", () => {
	it("shows the ask, the call by name, what was drawn and the final prose, never the code, the printed text or what the model read", async () => {
		session.messages = MESSAGES;
		const host = await mount(<ChatView />);
		const text = host.textContent ?? "";

		expect(text).toContain("make a chart");
		expect(text).toContain("drawn ui");
		expect(text).not.toContain("drawn for you");
		expect(text).toContain(PROSE);
		expect(text).not.toContain("draw-chart");
		expect(text).not.toContain("RESULT-VALUE");
		expect(text).not.toContain("MODEL-SAW");
	});

	it("keeps what the call said it was doing once settled, and adds no summary", async () => {
		session.messages = MESSAGES;
		const host = await mount(<ChatView />);

		expect(host.querySelector("[data-step-call]")?.textContent).toContain(
			"drawing the chart",
		);
		expect(host.querySelector("[data-turn-summary]")).toBeNull();
		expect(host.textContent).not.toContain("1 step");
	});

	it("opens the trace at the answer's own message from its metadata", async () => {
		session.messages = MESSAGES;
		const host = await mount(<ChatView />);
		const show = host.querySelector<HTMLButtonElement>(
			"[data-turn-answer] [data-show-in-trace]",
		);

		await act(async () => show?.click());

		expect(panels.apply).toHaveBeenCalledWith([traceOpen("c1", "a2")]);
	});

	it("opens the trace beside the chat in the same tab when the chat hosts one", async () => {
		session.messages = MESSAGES;
		const show = vi.fn();
		const host = await mount(
			<SideTraceProvider
				control={{ trace: { shown: "collapsed" }, show, toggle: vi.fn() }}
			>
				<ChatView />
			</SideTraceProvider>,
		);

		await act(async () =>
			host
				.querySelector<HTMLButtonElement>(
					"[data-turn-answer] [data-show-in-trace]",
				)
				?.click(),
		);

		expect(show).toHaveBeenCalledWith("a2");
		expect(panels.apply).not.toHaveBeenCalled();
	});

	it("opens the trace at the step that failed from the failure line", async () => {
		session.messages = [
			{ id: "h1", type: "human", content: "go" },
			{
				id: "t1",
				type: "tool",
				content: "",
				additional_kwargs: { failed: true },
			},
		];
		const host = await mount(<ChatView />);

		await act(async () =>
			host.querySelector<HTMLButtonElement>("[data-show-in-trace]")?.click(),
		);

		expect(panels.apply).toHaveBeenCalledWith([traceOpen("c1", "t1")]);
	});

	it("hides the trace control when the preference is off", async () => {
		session.messages = MESSAGES;
		stored.put({ traceLink: false });
		const host = await mount(<ChatView />);

		expect(host.querySelector("[data-show-in-trace]")).toBeNull();
		expect(host.textContent).toContain(PROSE);
	});

	it("shows the live intent and streams the answer's text while the turn runs", async () => {
		session.messages = MESSAGES;
		session.isLoading = true;
		const host = await mount(<ChatView />);
		const items = [...host.querySelectorAll("li[data-done]")];

		expect(host.textContent).toContain("drawing the chart");
		expect(items.map((li) => li.getAttribute("data-done"))).toEqual([
			"true",
			"false",
		]);
		expect(host.textContent).toContain(PROSE);
		expect(host.querySelector("[data-show-in-trace]")).toBeNull();
	});

	it("says what the agent is doing beside its avatar, not on the turn", async () => {
		session.messages = MESSAGES;
		session.isLoading = true;
		const host = await mount(<ChatView />);
		const status = host.querySelector("[data-agent-status]");

		expect(status?.getAttribute("data-agent-status")).toBe("writing");
		expect(status?.textContent).not.toBe("");
		expect(status?.textContent?.endsWith("...")).toBe(true);
		expect(host.querySelector('[data-turn-foot="live"]')).toBeNull();
	});

	it("shows no status once the turn settles", async () => {
		session.messages = MESSAGES;
		const host = await mount(<ChatView />);

		expect(host.querySelector("[data-agent-status]")).toBeNull();
	});

	it("names a failed step on the turn it belongs to", async () => {
		session.messages = [
			{ id: "h1", type: "human", content: "go" },
			{
				id: "t1",
				type: "tool",
				content: "",
				additional_kwargs: { failed: true },
			},
		];
		const host = await mount(<ChatView />);

		expect(host.textContent).toContain("a step in this turn failed");
	});
});

describe("a call's progress", () => {
	const PROGRESSED: ChatMessage[] = [
		{ id: "h1", type: "human", content: "count" },
		{ id: "a1", type: "ai", content: "(count-rows)" },
		{
			id: "t1",
			type: "tool",
			content: "",
			additional_kwargs: {
				intent: { progress: { done: 3, total: 10, label: "rows" } },
			},
		},
		{ id: "a2", type: "ai", content: "(next)" },
		{ id: "t2", type: "tool", content: "", additional_kwargs: { intent: {} } },
	];

	it("stays on the call that first showed it, live and once settled", async () => {
		session.messages = PROGRESSED;
		session.isLoading = true;
		const live = await mount(<ChatView />);
		const bar = live.querySelector('[role="progressbar"]');

		expect(bar?.getAttribute("aria-valuenow")).toBe("3");
		expect(bar?.getAttribute("aria-valuemax")).toBe("10");

		session.isLoading = false;
		const settled = await mount(<ChatView />);

		expect(
			settled
				.querySelector('[role="progressbar"]')
				?.getAttribute("aria-valuenow"),
		).toBe("3");
		expect(settled.textContent).not.toContain("2 steps");
	});
});

describe("the trace", () => {
	it("shows the code each step ran, what it printed and what it returned, every channel on", async () => {
		const host = await mount(<TraceLines messages={MESSAGES} />);
		for (const header of host.querySelectorAll<HTMLButtonElement>(
			"[data-step-header]",
		))
			await act(async () => header.click());
		const text = host.textContent ?? "";

		expect(text).toContain("(draw-chart)");
		expect(text).toContain("drawn for you");
		expect(text).toContain("RESULT-VALUE");
		expect(text).toContain("MODEL-SAW");
	});

	it("shows every form a step ran as its raw source, not only its name", async () => {
		const source =
			'(setq scout (spawn "scout" :prompt "Summarise what a task needs."))\n(setq critic (spawn "critic" :prompt "Name the biggest risk."))';
		const host = await mount(
			<TraceLines
				messages={[
					{ id: "h1", type: "human", content: "spawn them" },
					{ id: "a1", type: "ai", content: source },
					{
						id: "t1",
						type: "tool",
						content: '{"source":"lisp-repl","output":""}',
					},
				]}
			/>,
		);
		for (const header of host.querySelectorAll<HTMLButtonElement>(
			"[data-step-header]",
		))
			await act(async () => header.click());
		const text = host.textContent ?? "";

		expect(text).toContain(
			'(setq scout (spawn "scout" :prompt "Summarise what a task needs."))',
		);
		expect(text).toContain(
			'(setq critic (spawn "critic" :prompt "Name the biggest risk."))',
		);
	});

	it("hides a channel its toolbar turns off", async () => {
		const host = await mount(<TraceLines messages={MESSAGES} />);
		const output = [...host.querySelectorAll("button[aria-pressed]")].find(
			(b) => b.textContent === "output",
		) as HTMLButtonElement;

		await act(async () => output.click());

		expect(output.getAttribute("aria-pressed")).toBe("false");
		expect(host.textContent).not.toContain("RESULT-VALUE");
		expect(host.textContent).not.toContain("drawn for you");
	});
});

const call = (
	id: string,
	state: "started" | "done" | "failed",
	label = "linear · List issues",
) => ({ id, kind: "mcp", label, detail: "Lists the issues", state });

const ACTING: ChatMessage[] = [
	{ id: "h1", type: "human", content: "what is open?" },
	{
		id: "t1",
		type: "tool",
		content: "",
		additional_kwargs: {
			activity: [
				call("a", "started"),
				call("b", "started", "linear · Get issue"),
			],
		},
	},
	{
		id: "t2",
		type: "tool",
		content: "",
		additional_kwargs: { activity: [call("a", "done")] },
	},
];

describe("what a turn is doing", () => {
	it("merges a call's activity across steps by its id, in the order it began", () => {
		const [turn] = groupTurns(ACTING);
		const { activity } = shapeTurn(turn);

		expect(activity.map((e) => [e.id, e.state])).toEqual([
			["a", "done"],
			["b", "started"],
		]);
	});

	it("names the calls a step made on its row, and keeps their timeline under it", async () => {
		session.messages = ACTING;
		session.isLoading = true;
		const host = await mount(<ChatView />);

		expect(host.querySelector("[data-step-call]")?.textContent).toContain(
			"linear · Get issue",
		);
		expect(
			[...host.querySelectorAll("[data-timeline]")].map((li) =>
				li.getAttribute("data-timeline"),
			),
		).toEqual(["done", "running"]);
		expect(host.textContent).toContain("Lists the issues");
	});

	it("lets a declared doing line win over the calls on its row", async () => {
		session.messages = [
			{ id: "h1", type: "human", content: "go" },
			{
				id: "t1",
				type: "tool",
				content: "",
				additional_kwargs: {
					intent: { doing: "triaging" },
					activity: [call("a", "failed")],
				},
			},
		];
		const host = await mount(<ChatView />);
		const row = host.querySelector("[data-step-call]");

		expect(row?.textContent).toContain("triaging");
		expect(row?.textContent).not.toContain("linear · List issues");
		expect(
			host.querySelector("[data-timeline]")?.getAttribute("data-timeline"),
		).toBe("failed");
	});

	it("adds no count once the turn settles", async () => {
		session.messages = ACTING;
		const host = await mount(<ChatView />);

		expect(host.textContent).not.toContain("2 calls");
		expect(host.textContent).not.toContain("2 steps");
	});
});

const logged = {
	doing: "ship it",
	log: [
		{ text: "read the issues", startedAt: 0, ms: 820, state: "done" as const },
		{
			text: "draft the fix",
			startedAt: 1000,
			ms: 4200,
			state: "failed" as const,
		},
		{ text: "retry", startedAt: 6000, state: "running" as const },
	],
};

const timed = (
	id: string,
	startedAt: number | undefined,
	state: "started" | "done" | "failed",
	ms?: number,
) => ({ ...call(id, state, `call ${id}`), startedAt, ms });

describe("the turn timeline", () => {
	it("formats durations the way a person reads them", () => {
		expect(formatElapsed(820)).toBe("820ms");
		expect(formatElapsed(4200)).toBe("4.2s");
		expect(formatElapsed(63_000)).toBe("1m 03s");
	});

	it("nests each call under the intent line that was running when it began", () => {
		const timeline = turnTimeline(logged, [
			timed("a", 100, "done", 300),
			timed("b", 1500, "failed", 50),
			timed("c", 6100, "started"),
		]);

		expect(
			timeline.map((e) => [e.label, e.children.map((c) => c.label)]),
		).toEqual([
			["read the issues", ["call a"]],
			["draft the fix", ["call b"]],
			["retry", ["call c"]],
		]);
	});

	it("lists the calls at the top when nothing was logged", () => {
		const timeline = turnTimeline({ doing: "x" }, [
			timed("a", 100, "done"),
			timed("b", undefined, "started"),
		]);

		expect(timeline.map((e) => [e.label, e.state, e.children])).toEqual([
			["call a", "done", []],
			["call b", "running", []],
		]);
	});

	it("draws the timeline from the intent and activity a step annotated", async () => {
		session.messages = [
			{ id: "h1", type: "human", content: "go" },
			{
				id: "t1",
				type: "tool",
				content: "",
				additional_kwargs: {
					intent: { log: logged.log.slice(0, 2) },
					activity: [timed("a", 1200, "done", 90)],
				},
			},
		];
		const host = await mount(<ChatView />);
		const rows = [...host.querySelectorAll("[data-timeline]")].map((li) => [
			li.getAttribute("data-timeline"),
			li.querySelector("[data-elapsed]")?.textContent,
		]);

		expect(rows).toEqual([
			["done", "820ms"],
			["failed", "4.2s"],
			["done", "90ms"],
		]);
		expect(
			host.querySelector('[data-timeline="failed"] [data-timeline="done"]')
				?.textContent,
		).toContain("call a");
	});

	it("reads a settled turn's last line still marked running as done, with no duration", async () => {
		const host = await mount(
			<CallTimeline entries={turnTimeline(logged, [], false)} live={false} />,
		);
		const last = [...host.querySelectorAll("[data-timeline]")].at(-1);

		expect(last?.getAttribute("data-timeline")).toBe("done");
		expect(last?.querySelector("[data-elapsed]")).toBeNull();
	});

	it("stays in the chat once the turn settles, with ticks, a cross and durations", async () => {
		session.messages = [
			{ id: "h1", type: "human", content: "go" },
			{
				id: "t1",
				type: "tool",
				content: "",
				additional_kwargs: {
					intent: {
						todos: [{ label: "fix it", done: true }],
						log: logged.log.slice(0, 2),
					},
					activity: [timed("a", 100, "done", 300)],
				},
			},
		];
		const host = await mount(<ChatView />);
		const states = [...host.querySelectorAll("[data-timeline]")].map((li) =>
			li.getAttribute("data-timeline"),
		);
		const elapsed = [...host.querySelectorAll("[data-elapsed]")].map(
			(span) => span.textContent,
		);

		expect(states).toEqual(["done", "done", "failed"]);
		expect(elapsed).toEqual(["820ms", "300ms", "4.2s"]);
		expect(host.textContent).not.toContain("steps");
	});

	it("spins on the running line while the turn is live", async () => {
		const host = await mount(
			<CallTimeline entries={turnTimeline(logged, [], true)} live />,
		);
		const running = host.querySelector('[data-timeline="running"] svg');

		expect(running?.getAttribute("class")).toContain("animate-spin");
	});
});

describe("long text in the trace", () => {
	const lines = Array.from({ length: 20 }, (_, at) => `line-${at}`).join("\\n");
	const LONG: ChatMessage[] = [
		{ id: "a1", type: "ai", content: "(read-log)" },
		{
			id: "t1",
			type: "tool",
			content: `{"source":"lisp-repl","output":"${lines}"}`,
		},
	];

	it("folds behind read more, and opens on a click", async () => {
		const host = await mount(<TraceLines messages={LONG} turn="t1" />);
		const more = host.querySelector<HTMLButtonElement>("[data-read-more]");

		expect(host.textContent).toContain("line-0");
		expect(host.textContent).not.toContain("line-19");
		expect(more?.textContent).toBe("read more");

		await act(async () => more?.click());

		expect(host.textContent).toContain("line-19");
		expect(more?.textContent).toBe("read less");
	});
});

const STEPS: ChatMessage[] = [
	{ id: "h1", type: "human", content: "go" },
	...Array.from({ length: 9 }, (_, at): ChatMessage[] => [
		{ id: `a${at}`, type: "ai", content: `(step-${at})` },
		{
			id: `t${at}`,
			type: "tool",
			content: `{"source":"lisp-repl","output":"OUT-${at}"}`,
			additional_kwargs: at === 4 ? { failed: true } : {},
		},
	]).flat(),
];

describe("a trace's steps", () => {
	it("start folded, however few there are", async () => {
		const host = await mount(<TraceLines messages={MESSAGES} />);
		const headers = [...host.querySelectorAll("[data-step-header]")];

		expect(headers.length).toBeGreaterThan(0);
		expect(
			headers.every((h) => h.getAttribute("aria-expanded") === "false"),
		).toBe(true);
	});

	it("folds every step to a header and opens the one it was sent to", async () => {
		const host = await mount(<TraceLines messages={STEPS} turn="t4" />);
		const headers = [...host.querySelectorAll("[data-step-header]")];
		const open = headers.filter(
			(h) => h.getAttribute("aria-expanded") === "true",
		);

		expect(headers).toHaveLength(9);
		expect(open.map((h) => h.textContent)).toEqual(["▾step 5(step-4)failed"]);
		expect(host.textContent).toContain("OUT-4");
		expect(host.textContent).not.toContain("OUT-3");
		expect(
			host.querySelector('[data-message-id="t4"]')?.hasAttribute("data-flash"),
		).toBe(true);
	});

	it("opens the step it is sent to next, and lets a header open its step", async () => {
		const host = document.createElement("div");
		document.body.append(host);
		const root = createRoot(host);
		roots.push(root);
		const draw = (turn: string) =>
			act(async () =>
				root.render(
					<QueryClientProvider client={offline}>
						<UIProvider>
							<TraceLines messages={STEPS} turn={turn} />
						</UIProvider>
					</QueryClientProvider>,
				),
			);
		await draw("t4");
		await draw("a7");

		expect(host.textContent).toContain("OUT-7");

		const first = host.querySelector<HTMLButtonElement>("[data-step-header]");
		await act(async () => first?.click());

		expect(first?.getAttribute("aria-expanded")).toBe("true");
		expect(host.textContent).toContain("OUT-0");
	});

	it("opens a sub-agent's own trace under the step that started it", async () => {
		const spawned: ChatMessage[] = [
			{ id: "h1", type: "human", content: "ask the scout" },
			{ id: "a1", type: "ai", content: "(agents/spawn scout)" },
			{
				id: "t1",
				type: "tool",
				content: '{"source":"lisp-repl","output":"spawned"}',
				additional_kwargs: {
					activity: [
						{
							kind: "agent",
							label: "scout",
							state: "started",
							id: "scout",
							chat: "child-chat",
						},
					],
				},
			},
		];
		const child: ChatMessage[] = [
			{ id: "c1", type: "ai", content: "(look-around)" },
			{
				id: "c2",
				type: "tool",
				content: '{"source":"lisp-repl","output":"CHILD-SAW"}',
			},
		];
		const source = (chatId: string) => (chatId === "child-chat" ? child : []);
		const host = await mount(
			<TraceSourceProvider source={source}>
				<TraceLines messages={spawned} turn="t1" />
			</TraceSourceProvider>,
		);
		const opener = host.querySelector<HTMLButtonElement>(
			'[data-child-trace="child-chat"] > button',
		);

		expect(opener?.textContent).toContain("scout");
		expect(host.textContent).not.toContain("(look-around)");

		await act(async () => opener?.click());

		expect(host.textContent).toContain("(look-around)");
	});
});

const todoTurn = (id: string, todos: { label: string; done: boolean }[]) => [
	{ id: `h-${id}`, type: "human", content: id },
	{
		id: `t-${id}`,
		type: "tool",
		content: "",
		additional_kwargs: { intent: { todos } },
	},
];

describe("the todo card", () => {
	it("shows the todos of the latest turn that has any, and follows them live", async () => {
		session.isLoading = true;
		session.messages = [
			...todoTurn("old", [{ label: "old todo", done: false }]),
			...todoTurn("new", [
				{ label: "fetch", done: true },
				{ label: "draw", done: false },
			]),
			{ id: "h-last", type: "human", content: "no plan here" },
		];
		const host = document.createElement("div");
		document.body.append(host);
		const root = createRoot(host);
		roots.push(root);
		const draw = () =>
			act(async () =>
				root.render(
					<QueryClientProvider client={offline}>
						<UIProvider>
							<ChatView />
						</UIProvider>
					</QueryClientProvider>,
				),
			);
		await draw();
		const card = () => host.querySelector('[data-todo-card="card"]');

		expect(card()?.textContent).toContain("1/2");
		expect(card()?.textContent).toContain("draw");
		expect(card()?.textContent).not.toContain("old todo");
		expect(host.querySelector("[data-turn-intent] li[data-done]")).toBeNull();

		session.messages = [
			...session.messages,
			...todoTurn("next", [
				{ label: "fetch", done: true },
				{ label: "draw", done: true },
				{ label: "send", done: false },
			]),
		];
		await draw();

		expect(card()?.textContent).toContain("2/3");
		expect(card()?.textContent).toContain("send");
	});

	it("folds to a count chip in a narrow pane and opens on a click", async () => {
		const width = Object.getOwnPropertyDescriptor(
			HTMLElement.prototype,
			"clientWidth",
		);
		Object.defineProperty(HTMLElement.prototype, "clientWidth", {
			configurable: true,
			get: () => 300,
		});
		try {
			session.isLoading = true;
			session.messages = todoTurn("x", [
				{ label: "a", done: true },
				{ label: "b", done: false },
			]);
			const host = await mount(<ChatView />);
			const chip = host.querySelector<HTMLButtonElement>(
				'[data-todo-card="chip"]',
			);

			expect(chip?.textContent).toBe("1/2");
			expect(host.querySelector('[data-todo-card="card"]')).toBeNull();

			await act(async () => chip?.click());

			expect(host.querySelector('[data-todo-card="card"]')).not.toBeNull();
		} finally {
			if (width)
				Object.defineProperty(HTMLElement.prototype, "clientWidth", width);
		}
	});

	it("stays once a settled turn has every todo done", async () => {
		session.messages = todoTurn("x", [{ label: "a", done: true }]);
		const host = await mount(<ChatView />);

		expect(host.querySelector("[data-todo-card]")).not.toBeNull();
	});
});

describe("a turn's chain", () => {
	const CHAIN: ChatMessage[] = [
		{ id: "h1", type: "human", content: "read a" },
		{ id: "a1", type: "ai", content: 'Let me look.\n(fs/list "notes/")' },
		{ id: "t1", type: "tool", content: "" },
		{ id: "a2", type: "ai", content: 'Found it.\n(fs/read "a.md")' },
		{
			id: "t2",
			type: "tool",
			content: "",
			additional_kwargs: { failed: true },
		},
		{ id: "a3", type: "ai", content: "It is empty." },
	];

	const order = (host: HTMLElement, parts: string[]) =>
		parts.map((part) => (host.textContent ?? "").indexOf(part));

	it("keeps the text between the calls it made, in order, once settled", async () => {
		session.messages = CHAIN;
		session.isLoading = false;
		const host = await mount(<ChatView />);

		const at = order(host, ["Let me look.", "Found it.", "It is empty."]);
		expect(at.every((n) => n >= 0)).toBe(true);
		expect([...at].sort((a, b) => a - b)).toEqual(at);
		expect(host.textContent).not.toContain("fs/list");
		expect(host.textContent).not.toContain("fs/read");
	});

	it("keeps the text already written while the next call runs", async () => {
		session.messages = CHAIN.slice(0, 5);
		session.isLoading = true;
		const host = await mount(<ChatView />);

		expect(host.textContent).toContain("Let me look.");
		expect(host.textContent).toContain("Found it.");
		expect(host.querySelector("[data-step-call]")).toBeNull();
	});
});

describe("a step's thinking", () => {
	it("sits above the text of its own step, and stays once settled", async () => {
		session.messages = [
			{ id: "h1", type: "human", content: "oldest?" },
			{
				id: "a1",
				type: "ai",
				content: '(fs/list "notes/")',
				additional_kwargs: { reasoning_content: "list them first" },
			},
			{ id: "t1", type: "tool", content: "" },
			{
				id: "a2",
				type: "ai",
				content: "It is b.md.",
				additional_kwargs: { reasoning_content: "b is earliest" },
			},
		];
		session.isLoading = false;
		const host = await mount(<ChatView />);
		const text = host.textContent ?? "";

		expect(
			[...host.querySelectorAll("[data-step-thinking]")].map(
				(block) => block.textContent,
			),
		).toEqual(["list them first", "b is earliest"]);
		expect(text.indexOf("b is earliest")).toBeLessThan(
			text.indexOf("It is b.md."),
		);
	});
});

describe("a step still being written", () => {
	it("draws no row for a form being written, and streams none of its code", async () => {
		session.messages = [
			{ id: "h1", type: "human", content: "list" },
			{ id: "a1", type: "ai", content: 'Let me look.\n(fs/list "no' },
		];
		session.isLoading = true;
		const host = await mount(<ChatView />);

		expect(host.textContent).toContain("Let me look.");
		expect(host.querySelector("[data-step-call]")).toBeNull();
		expect(host.textContent).not.toContain("fs/list");
		expect(host.textContent).not.toContain('"no');
	});

	it("masks a prose-looking form until the step is classified, then shows what was classified prose", async () => {
		const reply = "Sure (as in yes, of course).\n(+ 1 2)";
		session.messages = [
			{ id: "h1", type: "human", content: "ok?" },
			{ id: "a1", type: "ai", content: reply },
		];
		session.isLoading = true;
		const streaming = await mount(<ChatView />);

		expect(streaming.textContent).not.toContain("as in yes");

		session.messages = [
			{ id: "h1", type: "human", content: "ok?" },
			{
				id: "a1",
				type: "ai",
				content: reply,
				additional_kwargs: { prose: [{ span: [5, 27], reason: "prose" }] },
			},
		];
		session.isLoading = false;
		const classified = await mount(<ChatView />);

		expect(classified.textContent).toContain("Sure (as in yes, of course).");
	});

	it("draws no row for prose that calls nothing", async () => {
		session.messages = [
			{ id: "h1", type: "human", content: "hi" },
			{ id: "a1", type: "ai", content: "Hello there" },
		];
		session.isLoading = true;
		const host = await mount(<ChatView />);

		expect(host.querySelector("[data-step-call]")).toBeNull();
		expect(host.textContent).toContain("Hello there");
	});
});
