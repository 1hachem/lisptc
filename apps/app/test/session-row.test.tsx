// @vitest-environment happy-dom
import type { Doc, Id } from "@repo/backend/dataModel";
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { SessionRow } from "../src/components/session-row.tsx";
import { traceOpen } from "../src/lib/panel-ops.ts";

const panels = vi.hoisted(() => ({ apply: vi.fn(), shown: false }));

vi.mock("../src/lib/panels.tsx", () => ({
	usePanels: () => ({ apply: panels.apply }),
}));
vi.mock("@convex-dev/react-query", () => ({
	useConvexMutation: () => vi.fn(),
	convexQuery: () => ({}),
}));
vi.mock("@tanstack/react-query", () => ({
	useQuery: () => ({
		data: panels.shown
			? [{ _id: "c2", workspaceId: "w1", title: "a sub-agent" }]
			: undefined,
	}),
}));
vi.mock("../src/lib/analytics.tsx", () => ({ reportIssue: vi.fn() }));
vi.mock("../src/lib/chat.tsx", () => ({ abandonChat: vi.fn() }));
vi.mock("../src/components/panel-link.tsx", () => ({
	PanelLink: ({ children }: { children: ReactNode }) => <span>{children}</span>,
	useShown: () => (content: { chatId?: string }) =>
		panels.shown && content.chatId === "c1",
}));
vi.mock("@repo/ui", async (importOriginal) => ({
	...(await importOriginal<typeof import("@repo/ui")>()),
	DropdownMenu: ({ children }: { children: ReactNode }) => (
		<div>{children}</div>
	),
	DropdownMenuTrigger: ({ children }: { children: ReactNode }) => (
		<span>{children}</span>
	),
	DropdownMenuContent: ({ children }: { children: ReactNode }) => (
		<div data-menu>{children}</div>
	),
	DropdownMenuSeparator: () => null,
	DropdownMenuItem: ({
		children,
		onSelect,
	}: {
		children: ReactNode;
		onSelect?: () => void;
	}) => (
		<button type="button" data-menu-item onClick={() => onSelect?.()}>
			{children}
		</button>
	),
}));

beforeAll(() => {
	(
		globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
	).IS_REACT_ACT_ENVIRONMENT = true;
});

const roots: Root[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) act(() => root.unmount());
	document.body.replaceChildren();
	panels.apply.mockClear();
	panels.shown = false;
});

const CHAT = {
	_id: "c1" as Id<"chats">,
	_creationTime: 0,
	workspaceId: "w1" as Id<"workspaces">,
	userId: "u1" as Id<"users">,
	title: "a chat",
} as Doc<"chats">;

describe("a chat's row in the sidebar", () => {
	it("opens the chat's trace from its menu", async () => {
		const host = document.createElement("div");
		document.body.append(host);
		const root = createRoot(host);
		roots.push(root);
		await act(async () => root.render(<SessionRow chat={CHAT} />));

		const item = [
			...host.querySelectorAll<HTMLButtonElement>("[data-menu-item]"),
		].find((b) => b.textContent === "open trace");
		await act(async () => item?.click());

		expect(item).toBeDefined();
		expect(panels.apply).toHaveBeenCalledWith([traceOpen("c1")]);
	});
	it("lists its sub-agents only once the chat is opened", async () => {
		const host = document.createElement("div");
		document.body.append(host);
		const root = createRoot(host);
		roots.push(root);
		await act(async () => root.render(<SessionRow chat={CHAT} />));
		expect(host.textContent).not.toContain("a sub-agent");

		panels.shown = true;
		await act(async () => root.render(<SessionRow chat={{ ...CHAT }} />));
		expect(host.textContent).toContain("a sub-agent");
	});
});
