// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
	dedicatedServers,
	type McpServerChip,
	McpServerChips,
	workspaceServers,
} from "../src/components/mcp-servers.tsx";

beforeAll(() => {
	(
		globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
	).IS_REACT_ACT_ENVIRONMENT = true;
});

const roots: Root[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) act(() => root.unmount());
	document.body.replaceChildren();
});

async function mount(
	servers: McpServerChip[],
	chatId: string | null = "chat-a",
) {
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	roots.push(root);
	await act(async () => {
		root.render(<McpServerChips servers={servers} chatId={chatId} />);
	});
	return host;
}

function texts(host: HTMLElement): (string | null)[] {
	return [...host.querySelectorAll("li")].map((li) => li.textContent);
}

describe("the MCP servers above the chat input", () => {
	it("lists only this chat's own servers, each with a dot for its phase", async () => {
		const host = await mount([
			{ server: "fs", phase: "ready", observedAt: 1 },
			{
				server: "playwright",
				instance: "chat-a",
				phase: "ready",
				observedAt: 1,
			},
			{
				server: "github",
				instance: "chat-a",
				phase: "failed",
				reason: "ImagePullBackOff",
				observedAt: 1,
			},
			{ server: "sheets", instance: "chat-b", phase: "ready", observedAt: 1 },
		]);

		expect(texts(host)).toEqual(["githubfailed", "playwrightready"]);
		const items = [...host.querySelectorAll("li")];
		expect(items.map((li) => li.querySelector("span")?.className)).toEqual([
			expect.stringContaining("bg-red"),
			expect.stringContaining("bg-green"),
		]);
		expect(items[0]?.title).toBe("failed: ImagePullBackOff");
	});

	it("draws nothing for a chat that runs no server of its own", async () => {
		const host = await mount([{ server: "fs", phase: "ready", observedAt: 1 }]);
		expect(host.children.length).toBe(0);
	});

	it("draws nothing when its own servers are asleep", async () => {
		const host = await mount([
			{ server: "fs", instance: "chat-a", phase: "sleeping", observedAt: 1 },
		]);
		expect(host.children.length).toBe(0);
	});

	it("draws nothing before the chat exists", async () => {
		const host = await mount(
			[{ server: "fs", instance: "chat-a", phase: "ready", observedAt: 1 }],
			null,
		);
		expect(host.children.length).toBe(0);
	});
});

describe("the workspace's MCP servers", () => {
	it("joins what is loaded, what runs and what was last read, leaving out every chat's own", () => {
		expect(
			workspaceServers(
				[
					{ server: "fs", phase: "ready", observedAt: 1 },
					{
						server: "playwright",
						instance: "chat-a",
						phase: "ready",
						observedAt: 1,
					},
				],
				["fs"],
				[
					{
						server: "sheets",
						description: "Google Sheets",
						icon: "https://example.com/sheets.png",
						login: true,
						tools: JSON.stringify([
							{ name: "read", description: "reads a range", inputSchema: {} },
						]),
						fetchedAt: 7,
					},
				],
			),
		).toEqual([
			{ server: "fs", phase: "ready", mounted: true, login: false, tools: [] },
			{
				server: "sheets",
				mounted: false,
				description: "Google Sheets",
				icon: "https://example.com/sheets.png",
				login: true,
				tools: [{ name: "read", description: "reads a range" }],
				fetchedAt: 7,
			},
		]);
	});
});

describe("the servers dedicated to a chat", () => {
	it("lists each chat's own server under its chat, leaving out the shared ones", () => {
		expect(
			dedicatedServers([
				{ server: "fs", phase: "ready", observedAt: 1 },
				{
					server: "playwright",
					instance: "chat-b",
					chatTitle: "scrape prices",
					phase: "sleeping",
					observedAt: 1,
				},
				{
					server: "github",
					instance: "chat-a",
					chatTitle: "triage issues",
					phase: "failed",
					reason: "ImagePullBackOff",
					observedAt: 1,
				},
				{
					server: "playwright",
					instance: "chat-a",
					chatTitle: "triage issues",
					phase: "ready",
					observedAt: 1,
				},
			]),
		).toEqual([
			{
				server: "github",
				chatId: "chat-a",
				chatTitle: "triage issues",
				phase: "failed",
				reason: "ImagePullBackOff",
			},
			{
				server: "playwright",
				chatId: "chat-b",
				chatTitle: "scrape prices",
				phase: "sleeping",
			},
			{
				server: "playwright",
				chatId: "chat-a",
				chatTitle: "triage issues",
				phase: "ready",
			},
		]);
	});
});
