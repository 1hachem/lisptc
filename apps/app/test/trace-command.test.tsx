// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SideTrace } from "../src/lib/panel-ops.ts";

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let chatId: string | null = null;

vi.mock("../src/lib/appearance.tsx", () => ({ useAppearance: () => ({}) }));
vi.mock("../src/lib/chat.tsx", () => ({
	useChatStore: () => ({ getState: () => ({ chatId, messages: [] }) }),
}));
vi.mock("../src/lib/chats.ts", () => ({ useNewChat: () => async () => {} }));
vi.mock("../src/lib/fork-picker.tsx", () => ({
	useForkPicker: () => ({}),
}));
vi.mock("../src/lib/model-picker.tsx", () => ({
	useModelPicker: () => ({}),
}));
vi.mock("../src/lib/transcript.ts", () => ({}));
vi.mock("../src/lib/ui.tsx", () => ({ useUI: () => ({}) }));

const { useCommandRunner } = await import("../src/lib/commands.ts");
const { SideTraceProvider } = await import("../src/lib/side-trace.tsx");

let trace: SideTrace = { shown: "collapsed" };
const control = {
	get trace() {
		return trace;
	},
	show: () => {
		trace = { shown: "open" };
	},
	toggle: () => {
		trace = { shown: trace.shown === "open" ? "collapsed" : "open" };
	},
};

async function run(name: string): Promise<string | null> {
	let runner: ((name: string) => Promise<string | null>) | undefined;
	function Probe() {
		runner = useCommandRunner();
		return null;
	}
	const root = createRoot(document.createElement("div"));
	act(() =>
		root.render(
			<SideTraceProvider control={control}>
				<Probe />
			</SideTraceProvider>,
		),
	);
	const shown = await (runner as (name: string) => Promise<string | null>)(
		name,
	);
	act(() => root.unmount());
	return shown;
}

afterEach(() => {
	trace = { shown: "collapsed" };
	chatId = null;
});

describe("/trace", () => {
	it("opens the trace beside the current chat", async () => {
		chatId = "c1";
		expect(await run("/trace")).toBeNull();
		expect(trace.shown).toBe("open");
	});

	it("collapses the trace beside the chat when it is already open", async () => {
		chatId = "c1";
		trace = { shown: "open" };
		expect(await run("/trace")).toBeNull();
		expect(trace.shown).toBe("collapsed");
	});

	it("says there is nothing to trace before the chat has started", async () => {
		expect(await run("/trace")).toBe("nothing to trace yet");
		expect(trace.shown).toBe("collapsed");
	});
});
