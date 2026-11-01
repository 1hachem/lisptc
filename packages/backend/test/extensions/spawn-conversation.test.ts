import type { Threads } from "@repo/ai";
import { newSym } from "@repo/interpreter/objects";
import { str } from "@repo/interpreter/print";
import type { ConversationEntry } from "@repo/interpreter/session";
import { type FunctionReference, getFunctionName } from "convex/server";
import { describe, expect, it } from "vitest";
import type { Id } from "../../convex/_generated/dataModel.js";
import type { Connect } from "../../src/agent-repl.ts";
import type { ServerClient } from "../../src/server-client.ts";
import { ThreadHost } from "../../src/thread-host.ts";

const PARENT = "parent-1" as Id<"chats">;
const CHILD = "child-1" as Id<"chats">;

const said: ConversationEntry[] = [
	{ role: "user", content: "find the bug" },
	{ role: "assistant", content: '(spawn "kid")' },
];

const named = (reference: unknown) =>
	getFunctionName(reference as FunctionReference<"query" | "mutation">);

function storingServer(): ServerClient {
	const layers = new Map<string, string[][]>();
	const answer = (reference: unknown, args: Record<string, unknown>) => {
		const name = named(reference);
		if (name === "threads:record")
			return Promise.resolve({
				workspaceId: "workspace-1",
				ownerId: "user-1",
				title: "chat",
				runsForms: true,
				lineage: [{}],
			});
		if (name === "threads:spawn") return Promise.resolve(CHILD);
		if (name === "threads:repl")
			return Promise.resolve(`repl-of-${args.chatId as string}`);
		if (name === "threads:transcript") return Promise.resolve([]);
		if (name === "repls:record") {
			const replId = args.replId as string;
			const chunks = args.chunks as string[];
			const kept = args.whole ? [] : (layers.get(replId) ?? []);
			layers.set(replId, [...kept, chunks]);
			return Promise.resolve(`layer-${kept.length}`);
		}
		if (name === "repls:latest") {
			const stack = layers.get(args.replId as string);
			if (stack === undefined) return Promise.resolve(null);
			return Promise.resolve({
				head: `layer-${stack.length - 1}`,
				depth: stack.length,
				layers: stack,
			});
		}
		return Promise.resolve(null);
	};
	return { query: answer, mutation: answer } as unknown as ServerClient;
}

const offline: Connect = () =>
	({
		query: (reference: unknown) =>
			Promise.resolve(named(reference).endsWith(":list") ? [] : null),
		mutation: () => Promise.resolve(null),
	}) as unknown as ReturnType<Connect>;

const threads = {
	spawn: async (
		_parent: string,
		_title: string,
		create: () => Promise<string>,
	) => await create(),
	ask: async () => "job-1",
	latest: () => undefined,
} as unknown as Threads;

async function spawned(repl: string, chat: string) {
	const host = new ThreadHost({
		server: storingServer(),
		actAs: () => offline(),
		threads: () => threads,
	});
	const parent = await host.repl(PARENT);
	for (const entry of said) parent.recorded(entry);
	await parent.eval(`(spawn "kid" :prompt "p" :repl :${repl} :chat :${chat})`);
	const child = await host.repl(CHILD);
	return (global: string) => str(child.interp.getGlobal(newSym(global)), true);
}

describe("a spawned agent's conversation", () => {
	it.each([
		"fresh",
		"fork",
	])("is empty with :chat :fresh and :repl :%s", async (repl) => {
		const read = await spawned(repl, "fresh");
		expect(read("conversation")).toBe("nil");
		expect(read("user-messages")).toBe("nil");
		expect(read("assistant-messages")).toBe("nil");
	});

	it.each([
		"fresh",
		"fork",
	])("is the parent's with :chat :fork and :repl :%s", async (repl) => {
		const read = await spawned(repl, "fork");
		expect(read("user-messages")).toBe('("find the bug")');
		expect(read("assistant-messages")).toBe('("(spawn \\"kid\\")")');
		expect(read("conversation")).toContain('"find the bug"');
	});
});
