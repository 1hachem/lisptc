import { ConversationInterpreter } from "@repo/interpreter/conversation";
import { driveAsync, settled } from "@repo/interpreter/drive";
import { Interp, runAsync } from "@repo/interpreter/lisp";
import { prelude } from "@repo/interpreter/prelude";
import { str } from "@repo/interpreter/print";
import { openSession } from "@repo/interpreter/session";
import { type FunctionReference, getFunctionName } from "convex/server";
import { describe, expect, it } from "vitest";
import type { Id } from "../../convex/_generated/dataModel.js";
import { type Connect, workspaceExtensions } from "../../src/agent-repl.ts";
import type { Desktop } from "../../src/desktop-bridge.ts";

const WORKSPACE = "workspace-1" as Id<"workspaces">;

function nothingStored(reference: unknown): Promise<unknown> {
	const name = getFunctionName(
		reference as FunctionReference<"query" | "mutation">,
	);
	return Promise.resolve(name.endsWith(":list") ? [] : null);
}

const offline: Connect = () =>
	({
		query: nothingStored,
		mutation: nothingStored,
	}) as unknown as ReturnType<Connect>;

async function served(): Promise<(code: string) => Promise<string>> {
	const interp = new Interp({
		extensions: await workspaceExtensions(WORKSPACE, offline),
	});
	await runAsync(interp, prelude);
	return async (code) => str((await runAsync(interp, code)).value, false);
}

describe("the agent the app serves", () => {
	it("asks before every form an extension says waits on the user", async () => {
		const ev = await served();
		for (const form of [
			"memory/forget-all",
			"settings/set",
			"chat/archive",
			"chat/read",
			"knowledge/write",
			"knowledge/delete",
			"knowledge/keep",
			"knowledge/unkeep",
			"attachments/fetch",
			"attachments/delete",
			"bin/restore",
			"bin/delete",
		])
			expect(await ev(`(permission/check '${form})`)).toBe("ask");
	});

	it("reads its settings and preferences without asking", async () => {
		const ev = await served();
		for (const form of [
			"settings",
			"chats",
			"knowledge/list",
			"knowledge/read",
			"attachments/read",
			"attachments/write",
			"bin/list",
			"bin/search",
			"preferences",
			"preferences/set",
		])
			expect(await ev(`(permission/check '${form})`)).toBe("allow");
	});

	it("ships every extension's built-in memories readable, under distinct keys, within their budget", async () => {
		const ev = await served();
		const keys = (
			await ev("(mapcar (lambda (entry) (car entry)) (memory/builtins))")
		)
			.slice(1, -1)
			.split(" ")
			.map((key) => JSON.parse(key) as string);
		expect(keys).toEqual(
			expect.arrayContaining(["internal/mcp/local", "internal/mcp/oauth"]),
		);
		expect(new Set(keys).size).toBe(keys.length);
		expect(await ev("(length (memory/areas :when))")).not.toBe("0");
	});

	it("hands back every built-in memory's body as formatted text", async () => {
		const ev = await served();
		const keys = (
			await ev("(mapcar (lambda (entry) (car entry)) (memory/builtins))")
		)
			.slice(1, -1)
			.split(" ")
			.map((key) => JSON.parse(key) as string);
		const bodyOf = (key: string) =>
			ev(
				`(cdr (assoc "body" (car (filter (lambda (m) (equal (cdr (assoc "key" m)) ${JSON.stringify(key)})) (memory/recall ${JSON.stringify(key)} :limit 500)))))`,
			);
		for (const key of keys) {
			const body = await bodyOf(key);
			expect(body, key).not.toBe("nil");
			expect(body, key).not.toMatch(/^\(format /);
		}
		expect(await bodyOf("internal/memory/triggers")).toContain(
			"rests 100 steps",
		);
		expect(await bodyOf("internal/preferences/metadata")).toContain(
			":input input tokens",
		);
	});

	it("teaches the model the workspace, its knowledge and its preferences", async () => {
		const interp = new Interp({
			extensions: await workspaceExtensions(WORKSPACE, offline),
		});
		const prompt = interp.systemPrompt();
		expect(prompt).toContain("WORKSPACE");
		expect(prompt).toContain("KNOWLEDGE");
		expect(prompt).toContain("PREFERENCES");
	});

	it("reads the desktop's presence off the bridge at the start of each step", async () => {
		const online = { value: false };
		const desktop: Desktop = {
			connected: () => online.value,
			open: async () => ({
				start: async () => {},
				send: async () => {},
				close: async () => {},
			}),
			close: async () => {},
			running: () => true,
			settings: async () => undefined,
		};
		const extensions = await workspaceExtensions(WORKSPACE, offline, {
			desktop,
		});
		const interp = new ConversationInterpreter({ extensions });
		await runAsync(interp, prelude);
		const hooks = openSession(extensions);
		const step = () =>
			driveAsync(hooks.beginStep.run(() => settled(undefined), { interp }));
		const asked = async () =>
			str((await runAsync(interp, "(desktop-connected-p)")).value, false);
		await step();
		expect(await asked()).toBe("nil");
		online.value = true;
		await step();
		expect(await asked()).toBe("t");
	});
});
