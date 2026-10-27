import { Interp, runAsync } from "@repo/interpreter/lisp";
import { prelude } from "@repo/interpreter/prelude";
import { str } from "@repo/interpreter/print";
import { type FunctionReference, getFunctionName } from "convex/server";
import { describe, expect, it } from "vitest";
import type { Id } from "../../convex/_generated/dataModel.js";
import { type Connect, workspaceExtensions } from "../../src/agent-repl.ts";

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

	it("teaches the model the workspace, its knowledge and its preferences", async () => {
		const interp = new Interp({
			extensions: await workspaceExtensions(WORKSPACE, offline),
		});
		const prompt = interp.systemPrompt();
		expect(prompt).toContain("WORKSPACE");
		expect(prompt).toContain("KNOWLEDGE");
		expect(prompt).toContain("PREFERENCES");
	});
});
