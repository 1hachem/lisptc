import { type Activity, activityKey } from "@repo/interpreter/annotations";
import { bufferTransport } from "@repo/interpreter/channels-host";
import { Interp, runAsync, runSync } from "@repo/interpreter/lisp";
import { prelude } from "@repo/interpreter/prelude";
import type { LispPromise } from "@repo/interpreter/promise";
import { noAnnotations, openSession } from "@repo/interpreter/session";
import { describe, expect, it } from "vitest";
import { mcpExtension } from "../src/mcp.ts";
import { mcpHost } from "../src/mcp-host.ts";
import type { McpClient, Tool } from "../src/ports.ts";

const TOOLS: Tool[] = [
	{
		name: "web_search",
		title: "Web search",
		description:
			"Searches the web for a query. Returns the top results with their links.\nSecond line.",
	},
	{
		name: "fetch_page",
		annotations: { title: "Fetch page" },
		description: `Fetches ${"a very long page description ".repeat(8)}`,
	},
	{ name: "explode" },
];

function fakeClient(): McpClient {
	return {
		connect: async () => ({ serverId: "acme-1", tools: TOOLS }),
		callTool: async (call) => {
			if (call.tool === "explode") throw new Error("boom");
			return { ok: true };
		},
		disconnect: () => Promise.resolve(),
		login: () => Promise.resolve({ authUrl: null }),
		logout: () => Promise.resolve(),
		authorize: () => Promise.resolve(),
		shutdown: () => Promise.resolve(),
	};
}

function ticking(from: number, step: number): { now(): number } {
	let at = from - step;
	return {
		now: () => {
			at += step;
			return at;
		},
	};
}

async function session() {
	const extension = mcpExtension({
		...mcpHost,
		client: fakeClient(),
		clock: ticking(1000, 25),
	});
	const interp = new Interp({ extensions: [extension] });
	runSync(interp, prelude);
	await (runSync(
		interp,
		'(load-mcp :name "acme" :url "https://acme.example/mcp")',
	) as LispPromise);
	return { interp, hooks: openSession([extension]) };
}

async function activityOf(code: string): Promise<{
	activity: Activity | undefined;
	reported: unknown[];
}> {
	const { interp, hooks } = await session();
	const buffer = bufferTransport();
	const detach = interp.channels.pipe(buffer);
	try {
		await runAsync(interp, code).catch(() => undefined);
	} finally {
		detach();
	}
	const into = hooks.annotate.run((_b, into) => into, buffer, noAnnotations());
	return {
		activity: activityKey.schema.safeParse(into.output[activityKey.name]).data,
		reported: buffer.envelopes
			.filter((e) => e.topic === "mcp-activity")
			.map((e) => [e.to, (e.payload as { state: string }).state]),
	};
}

describe("a tool call from lisp", () => {
	it("reports started to the user, then done, with the tool's first sentence", async () => {
		const { activity, reported } = await activityOf(
			'(acme/web_search :query "hyko")',
		);
		expect(reported).toEqual([
			[["user"], "started"],
			[["user"], "done"],
		]);
		expect(activity).toEqual([
			{
				kind: "mcp",
				icon: "tool",
				label: "acme · Web search",
				detail: "Searches the web for a query.",
				state: "done",
				id: "mcp-1",
				startedAt: 1000,
				ms: 25,
			},
		]);
	});

	it("reports failed when the call fails", async () => {
		const { activity } = await activityOf("(acme/explode)");
		expect(activity).toEqual([
			{
				kind: "mcp",
				icon: "tool",
				label: "acme · explode",
				state: "failed",
				error: "boom",
				id: "mcp-1",
				startedAt: 1000,
				ms: 25,
			},
		]);
	});

	it("gives every call its own id, labels by the annotation title and trims a long detail", async () => {
		const { activity } = await activityOf(
			'(acme/fetch_page) (acme/web_search :query "a")',
		);
		expect(
			activity?.map((a) => [a.id, a.label, a.state, a.startedAt, a.ms]),
		).toEqual([
			["mcp-1", "acme · Fetch page", "done", 1000, 25],
			["mcp-2", "acme · Web search", "done", 1050, 25],
		]);
		expect(activity?.[0].detail?.length).toBeLessThanOrEqual(120);
		expect(activity?.[0].detail?.endsWith("…")).toBe(true);
	});
});
