// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
	type McpServerChip,
	McpServerChips,
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

async function mount(servers: McpServerChip[]) {
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	roots.push(root);
	await act(async () => {
		root.render(<McpServerChips servers={servers} />);
	});
	return host;
}

describe("the MCP servers above the chat input", () => {
	it("lists each server by name with a dot for its phase", async () => {
		const host = await mount([
			{ server: "playwright", phase: "ready", observedAt: 1 },
			{
				server: "github",
				phase: "failed",
				reason: "ImagePullBackOff",
				observedAt: 1,
			},
			{ server: "fs", phase: "starting", observedAt: 1 },
		]);

		const items = [...host.querySelectorAll("li")];
		expect(items.map((li) => li.textContent)).toEqual([
			"fsstarting",
			"githubfailed",
			"playwrightready",
		]);
		expect(items.map((li) => li.querySelector("span")?.className)).toEqual([
			expect.stringContaining("bg-yellow"),
			expect.stringContaining("bg-red"),
			expect.stringContaining("bg-green"),
		]);
		expect(items[1]?.title).toBe("failed: ImagePullBackOff");
	});

	it("stops mentioning a server once it is unloaded and asleep", async () => {
		const host = await mount([
			{ server: "playwright", phase: "ready", observedAt: 1 },
			{ server: "fs", phase: "sleeping", observedAt: 1 },
		]);

		const items = [...host.querySelectorAll("li")];
		expect(items.map((li) => li.textContent)).toEqual(["playwrightready"]);
	});

	it("draws nothing when the workspace runs no server", async () => {
		const host = await mount([]);
		expect(host.children.length).toBe(0);
	});

	it("draws nothing when every server is asleep", async () => {
		const host = await mount([
			{ server: "fs", phase: "sleeping", observedAt: 1 },
		]);
		expect(host.children.length).toBe(0);
	});
});

describe("the MCP servers a chat sees", () => {
	it("shows the workspace's shared servers and only its own instances", async () => {
		const host = document.createElement("div");
		document.body.append(host);
		const root = createRoot(host);
		roots.push(root);
		await act(async () => {
			root.render(
				<McpServerChips
					chatId="chat-a"
					servers={[
						{ server: "fs", phase: "ready", observedAt: 1 },
						{
							server: "playwright",
							instance: "chat-a",
							phase: "ready",
							observedAt: 1,
						},
						{
							server: "playwright",
							instance: "chat-b",
							phase: "ready",
							observedAt: 1,
						},
					]}
				/>,
			);
		});

		expect(
			[...host.querySelectorAll("li")].map((li) => li.textContent),
		).toEqual(["fsready", "playwright (own)ready"]);
	});
});
