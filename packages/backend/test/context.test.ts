import { describe, expect, it } from "vitest";
import { api, internal } from "../convex/_generated/api.js";
import { harness, signIn } from "./helpers.ts";

async function watching(keys: string[]) {
	const t = harness();
	const alice = await signIn(t, "alice@example.com");
	const workspaceId = alice.workspace;
	const chatId = await alice.as.mutation(api.chats.create, { workspaceId });
	const observe = (key: string, state: string, detail?: string) =>
		t.mutation(internal.context.observe, {
			workspaceId,
			source: "mcp",
			key,
			state,
			...(detail === undefined ? {} : { detail }),
		});
	const watch = (watched: string[]) =>
		alice.as.mutation(api.context.watch, {
			chatId,
			source: "mcp",
			keys: watched,
		});
	await watch(keys);
	const told = async () =>
		(await alice.as.query(api.messages.transcript, { chatId })).map(
			(m) => m.content,
		);
	return { t, alice, workspaceId, chatId, observe, watch, told };
}

describe("the context diff", () => {
	it("tells a watching chat what changed, through the source's rule", async () => {
		const { observe, told } = await watching(["fs"]);
		await observe("fs", "ready");
		await observe("fs", "failed", "OOMKilled");

		const said = await told();
		expect(said).toHaveLength(1);
		expect(said[0]).toContain('"fs" failed (OOMKilled)');
	});

	it("says nothing when the state did not change", async () => {
		const { observe, told } = await watching(["fs"]);
		await observe("fs", "sleeping");
		await observe("fs", "sleeping");
		expect(await told()).toHaveLength(1);
	});

	it("does not replay what was already true when the chat started watching", async () => {
		const { observe, watch, told } = await watching([]);
		await observe("fs", "failed");
		await watch(["fs"]);
		expect(await told()).toEqual([]);

		await observe("fs", "ready");
		await observe("fs", "failed");
		expect(await told()).toHaveLength(1);
	});

	it("leaves a chat out of a key it does not watch", async () => {
		const { observe, told } = await watching(["github"]);
		await observe("fs", "sleeping");
		expect(await told()).toEqual([]);
	});

	it("refuses a source with no rule, from a producer or a watcher", async () => {
		const { t, alice, workspaceId, chatId } = await watching([]);
		await expect(
			t.mutation(internal.context.observe, {
				workspaceId,
				source: "nobody",
				key: "x",
				state: "on",
			}),
		).rejects.toThrow(/no context rule/);
		await expect(
			alice.as.mutation(api.context.watch, {
				chatId,
				source: "nobody",
				keys: ["x"],
			}),
		).rejects.toThrow(/no context rule/);
	});
});
