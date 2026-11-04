import { type Activity, activityKey } from "@repo/interpreter/annotations";
import { bufferTransport } from "@repo/interpreter/channels-host";
import { Interp, runAsync, runSync } from "@repo/interpreter/lisp";
import { prelude } from "@repo/interpreter/prelude";
import type { LispPromise } from "@repo/interpreter/promise";
import { noAnnotations, openSession } from "@repo/interpreter/session";
import { describe, expect, it } from "vitest";
import { mcpExtension } from "../src/mcp.ts";
import { mcpHost } from "../src/mcp-host.ts";
import type { Icon, McpClient, Tool } from "../src/ports.ts";

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
	{
		name: "painted",
		icons: [
			{ src: "javascript:alert(1)" },
			{ src: "https://acme.example/tool-light.png", theme: "light" },
			{ src: "https://acme.example/tool-dark.png", theme: "dark" },
		],
	},
	{ name: "unsafe", icons: [{ src: "http://acme.example/plain.png" }] },
];

const SERVER_ICONS: Icon[] = [
	{ src: "https://acme.example/logo.svg", mimeType: "image/svg+xml" },
];

function fakeClient(icons: Icon[] | undefined = SERVER_ICONS): McpClient {
	return {
		connect: async () => ({
			serverId: "acme-1",
			tools: TOOLS,
			...(icons === undefined ? {} : { icons }),
		}),
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

async function session(icons?: Icon[]) {
	const extension = mcpExtension({
		...mcpHost,
		client: fakeClient(icons),
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

async function activityOf(
	code: string,
	icons?: Icon[],
): Promise<Activity | undefined> {
	const { interp, hooks } = await session(icons);
	const buffer = bufferTransport();
	const detach = interp.channels.pipe(buffer);
	try {
		await runAsync(interp, code).catch(() => undefined);
	} finally {
		detach();
	}
	const into = hooks.annotate.run((_b, into) => into, buffer, noAnnotations());
	return activityKey.schema.safeParse(into.output[activityKey.name]).data;
}

describe("a tool call from lisp", () => {
	it("reports a finished call under the tool's title, with its first sentence", async () => {
		const activity = await activityOf('(acme/web_search :query "hyko")');
		expect(activity).toMatchObject([
			{
				kind: "mcp",
				icon: [{ src: "https://acme.example/logo.svg" }],
				label: "acme · Web search",
				detail: "Searches the web for a query.",
				state: "done",
				ms: 25,
			},
		]);
	});

	it("reports failed when the call fails", async () => {
		const activity = await activityOf("(acme/explode)");
		expect(activity).toMatchObject([
			{
				kind: "mcp",
				icon: [{ src: "https://acme.example/logo.svg" }],
				label: "acme · explode",
				state: "failed",
				error: "boom",
				ms: 25,
			},
		]);
	});

	it("gives every call its own id, labels by the annotation title and trims a long detail", async () => {
		const activity = await activityOf(
			'(acme/fetch_page) (acme/web_search :query "a")',
		);
		expect(activity?.map((a) => [a.label, a.state])).toEqual([
			["acme · Fetch page", "done"],
			["acme · Web search", "done"],
		]);
		expect(new Set(activity?.map((a) => a.id)).size).toBe(2);
		expect(activity?.[0].detail?.length).toBeLessThanOrEqual(120);
		expect(activity?.[0].detail?.endsWith("…")).toBe(true);
	});
});

describe("loading a server", () => {
	it("reports the load as done once it connects", async () => {
		const extension = mcpExtension({
			...mcpHost,
			client: fakeClient(),
			clock: ticking(1000, 25),
		});
		const interp = new Interp({ extensions: [extension] });
		runSync(interp, prelude);
		const hooks = openSession([extension]);
		const buffer = bufferTransport();
		const detach = interp.channels.pipe(buffer);
		try {
			await (runSync(
				interp,
				'(load-mcp :name "acme" :url "https://acme.example/mcp")',
			) as LispPromise);
		} finally {
			detach();
		}
		const into = hooks.annotate.run(
			(_b, into) => into,
			buffer,
			noAnnotations(),
		);
		expect(
			activityKey.schema.parse(into.output[activityKey.name]),
		).toMatchObject([
			{
				kind: "mcp",
				icon: [{ src: "https://acme.example/logo.svg" }],
				label: "load-mcp · acme",
				state: "done",
				ms: 25,
			},
		]);
	});
});

describe("an mcp icon", () => {
	it("shows the tool's own icons ahead of the server's, dropping unsafe sources", async () => {
		const activity = await activityOf("(acme/painted)");
		expect(activity?.[0].icon).toEqual([
			{ src: "https://acme.example/tool-light.png", theme: "light" },
			{ src: "https://acme.example/tool-dark.png", theme: "dark" },
		]);
	});

	it("falls back to the server's icon when the tool's are all unsafe", async () => {
		const activity = await activityOf("(acme/unsafe)");
		expect(activity?.[0].icon).toEqual([
			{ src: "https://acme.example/logo.svg" },
		]);
	});

	it("drops an oversized data icon and falls back to the tool icon", async () => {
		const activity = await activityOf("(acme/explode)", [
			{ src: `data:image/png;base64,${"A".repeat(9000)}` },
		]);
		expect(activity?.[0].icon).toBe("tool");
	});
});
