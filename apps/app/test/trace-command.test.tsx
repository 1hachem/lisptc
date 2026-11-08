// @vitest-environment happy-dom
import type { PanelOp } from "@repo/shared/panel-layout";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PanelContent } from "../src/lib/panel-ops.ts";

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
const { traceOpen } = await import("../src/lib/panel-ops.ts");
const { usePanelRequests } = await import("../src/lib/panel-requests.ts");

const requested: (readonly PanelOp<PanelContent>[])[] = [];
const record = (ops: readonly PanelOp<PanelContent>[]) => {
	requested.push(ops);
};

async function run(name: string): Promise<string | null> {
	let runner: ((name: string) => Promise<string | null>) | undefined;
	function Probe() {
		usePanelRequests(record);
		runner = useCommandRunner();
		return null;
	}
	const root = createRoot(document.createElement("div"));
	act(() => root.render(<Probe />));
	const shown = await (runner as (name: string) => Promise<string | null>)(
		name,
	);
	act(() => root.unmount());
	return shown;
}

afterEach(() => {
	requested.length = 0;
	chatId = null;
});

describe("/trace", () => {
	it("opens the trace of the current chat", async () => {
		chatId = "c1";
		expect(await run("/trace")).toBeNull();
		expect(requested).toEqual([[traceOpen("c1")]]);
	});

	it("says there is nothing to trace before the chat has started", async () => {
		expect(await run("/trace")).toBe("nothing to trace yet");
		expect(requested).toEqual([]);
	});
});
