import type { TestConvex } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../convex/_generated/api.js";
import type { Id } from "../convex/_generated/dataModel.js";
import type schema from "../convex/schema.ts";
import { harness, type Signed, signIn } from "./helpers.ts";

const PAST_A_BATCH = 257;

afterEach(() => {
	vi.useRealTimers();
});

describe("removing a chat", () => {
	it("takes its messages with it", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		const chatId = await alice.as.mutation(api.chats.create, {
			workspaceId: alice.workspace,
		});
		await alice.as.mutation(api.messages.append, {
			chatId,
			messages: [{ type: "human", content: "hello" }],
		});

		vi.useFakeTimers();
		await alice.as.mutation(api.chats.remove, { chatId });
		await t.finishAllScheduledFunctions(vi.runAllTimers);

		const left = await t.run(
			async (ctx) => await ctx.db.query("messages").collect(),
		);
		expect(left).toEqual([]);
	});

	it("drops it from the list at once", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		const kept = await alice.as.mutation(api.chats.create, {
			workspaceId: alice.workspace,
			title: "kept",
		});
		const gone = await alice.as.mutation(api.chats.create, {
			workspaceId: alice.workspace,
			title: "gone",
		});

		await alice.as.mutation(api.chats.remove, { chatId: gone });

		const listed = await alice.as.query(api.chats.list, {
			workspaceId: alice.workspace,
		});
		expect(listed.chats.map((c) => c._id)).toEqual([kept]);
	});

	it("refuses a chat owned by someone else", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		const bob = await signIn(t, "bob@example.com");
		const chatId = await bob.as.mutation(api.chats.create, {
			workspaceId: bob.workspace,
		});
		await expect(
			alice.as.mutation(api.chats.remove, { chatId }),
		).rejects.toThrow();
	});
});

describe("removing a workspace", () => {
	it("takes its chats and their messages with it", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		const doomed = await alice.as.mutation(api.workspaces.create, {
			name: "doomed",
		});
		const chatId = await alice.as.mutation(api.chats.create, {
			workspaceId: doomed,
		});
		await alice.as.mutation(api.messages.append, {
			chatId,
			messages: [{ type: "human", content: "hello" }],
		});

		vi.useFakeTimers();
		await alice.as.mutation(api.workspaces.remove, { workspaceId: doomed });
		await t.finishAllScheduledFunctions(vi.runAllTimers);

		const { chats, messages } = await t.run(async (ctx) => ({
			chats: await ctx.db.query("chats").collect(),
			messages: await ctx.db.query("messages").collect(),
		}));
		expect(chats).toEqual([]);
		expect(messages).toEqual([]);
	});

	it("takes its secrets, oauth records, permissions, readme and files with it", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		const doomed = await alice.as.mutation(api.workspaces.create, {
			name: "doomed",
		});
		await alice.as.mutation(api.secrets.put, {
			workspaceId: doomed,
			secret: { key: "REPL_TOKEN", value: "doomed", description: "" },
		});
		await alice.as.mutation(api.oauth.put, {
			workspaceId: doomed,
			serverKey: "https://sheets.example.com",
			record: JSON.stringify({ tokens: { access_token: "doomed" } }),
		});
		await alice.as.mutation(api.permissions.put, {
			workspaceId: doomed,
			source: "(permission/deny eval)",
		});
		await alice.as.mutation(api.readmes.put, {
			workspaceId: doomed,
			body: "# doomed",
		});
		await alice.as.mutation(api.files.put, {
			workspaceId: doomed,
			path: "landing-page.ptc",
			source: '(:title "doomed")\n',
		});

		vi.useFakeTimers();
		await alice.as.mutation(api.workspaces.remove, { workspaceId: doomed });
		await t.finishAllScheduledFunctions(vi.runAllTimers);

		const { secrets, oauthRecords, permissions, readmes, files } = await t.run(
			async (ctx) => ({
				secrets: await ctx.db.query("secrets").collect(),
				oauthRecords: await ctx.db.query("oauthRecords").collect(),
				permissions: await ctx.db.query("permissions").collect(),
				readmes: await ctx.db.query("readmes").collect(),
				files: await ctx.db.query("files").collect(),
			}),
		);
		expect(secrets).toEqual([]);
		expect(oauthRecords).toEqual([]);
		expect(permissions).toEqual([]);
		expect(readmes).toEqual([]);
		expect(files).toEqual([]);
	});

	it("leaves the other workspaces alone", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		const doomed = await alice.as.mutation(api.workspaces.create, {
			name: "doomed",
		});

		const landing = await alice.as.mutation(api.workspaces.remove, {
			workspaceId: doomed,
		});

		expect(landing).toEqual(alice.workspace);
		const listed = await alice.as.query(api.workspaces.list, {});
		expect(listed.map((w) => w._id)).toEqual([alice.workspace]);
	});

	it("replaces the last one rather than leaving none", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");

		const landing = await alice.as.mutation(api.workspaces.remove, {
			workspaceId: alice.workspace,
		});

		expect(landing).not.toEqual(alice.workspace);
		const listed = await alice.as.query(api.workspaces.list, {});
		expect(listed.map((w) => w._id)).toEqual([landing]);
	});

	it("refuses a workspace owned by someone else", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		const bob = await signIn(t, "bob@example.com");
		await expect(
			alice.as.mutation(api.workspaces.remove, { workspaceId: bob.workspace }),
		).rejects.toThrow();
	});
});

describe("creating a workspace", () => {
	it("refuses one past the cap of 25", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		for (let i = 1; i < 25; i++) {
			await alice.as.mutation(api.workspaces.create, { name: `extra ${i}` });
		}

		await expect(
			alice.as.mutation(api.workspaces.create, { name: "one too many" }),
		).rejects.toThrow("TOO_MANY_WORKSPACES");
		const listed = await alice.as.query(api.workspaces.list, {});
		expect(listed).toHaveLength(25);
	});
});

async function addChat(
	t: TestConvex<typeof schema>,
	who: Signed,
	workspaceId: Id<"workspaces">,
	messages: number,
): Promise<void> {
	await t.run(async (ctx) => {
		const chatId = await ctx.db.insert("chats", {
			workspaceId,
			userId: who.user,
			title: "chat",
		});
		for (let seq = 0; seq < messages; seq++) {
			await ctx.db.insert("messages", {
				chatId,
				workspaceId,
				seq,
				type: "human",
				content: "hello",
			});
		}
	});
}

async function deleteAccount(
	t: TestConvex<typeof schema>,
	who: Signed,
): Promise<void> {
	const authId = await t.run(
		async (ctx) => (await ctx.db.get(who.user))?.authId,
	);
	vi.useFakeTimers();
	await t.mutation(internal.auth.onDelete, {
		model: "user",
		doc: { _id: authId },
	});
	await t.finishAllScheduledFunctions(vi.runAllTimers);
}

async function remaining(t: TestConvex<typeof schema>) {
	return await t.run(async (ctx) => ({
		users: await ctx.db.query("users").collect(),
		workspaces: await ctx.db.query("workspaces").collect(),
		chats: await ctx.db.query("chats").collect(),
		messages: await ctx.db.query("messages").collect(),
		memories: await ctx.db.query("memories").collect(),
		secrets: await ctx.db.query("secrets").collect(),
		oauthRecords: await ctx.db.query("oauthRecords").collect(),
		permissions: await ctx.db.query("permissions").collect(),
		readmes: await ctx.db.query("readmes").collect(),
		files: await ctx.db.query("files").collect(),
		preferences: await ctx.db.query("preferences").collect(),
	}));
}

const nothing = {
	users: [],
	workspaces: [],
	chats: [],
	messages: [],
	memories: [],
	secrets: [],
	oauthRecords: [],
	permissions: [],
	readmes: [],
	files: [],
	preferences: [],
};

describe("deleting an account", () => {
	it("takes chats of a full batch of messages and more", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		await addChat(t, alice, alice.workspace, 256);
		await addChat(t, alice, alice.workspace, PAST_A_BATCH);

		await deleteAccount(t, alice);

		expect(await remaining(t)).toEqual(nothing);
	});

	it("takes more chats and workspaces than one batch holds", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		for (let i = 0; i < PAST_A_BATCH; i++) {
			await addChat(t, alice, alice.workspace, 1);
		}
		await t.run(async (ctx) => {
			for (let i = 0; i < PAST_A_BATCH; i++) {
				await ctx.db.insert("workspaces", {
					ownerId: alice.user,
					name: `extra ${i}`,
					slug: `extra-${i}`,
				});
			}
		});

		await deleteAccount(t, alice);

		expect(await remaining(t)).toEqual(nothing);
	});

	it("takes its memories, secrets, oauth records, permissions, readme, files and preferences", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		await alice.as.mutation(api.readmes.put, {
			workspaceId: alice.workspace,
			body: "doomed",
		});
		await alice.as.mutation(api.files.put, {
			workspaceId: alice.workspace,
			path: "notes.ptc",
			source: "(:a 1)\n",
		});
		await alice.as.mutation(api.preferences.put, {
			preferences: { theme: "dusk", themeUses: {} },
		});
		await alice.as.mutation(api.secrets.put, {
			workspaceId: alice.workspace,
			secret: { key: "REPL_TOKEN", value: "doomed", description: "" },
		});
		await alice.as.mutation(api.oauth.put, {
			workspaceId: alice.workspace,
			serverKey: "https://sheets.example.com",
			record: JSON.stringify({ tokens: { access_token: "doomed" } }),
		});
		await alice.as.mutation(api.permissions.put, {
			workspaceId: alice.workspace,
			source: "(permission/deny eval)",
		});
		await t.run(async (ctx) => {
			await ctx.db.insert("memories", {
				workspaceId: alice.workspace,
				key: "doomed",
				body: "doomed",
				links: [],
				score: 0,
				used: 0,
				lastUsed: 0,
			});
		});

		await deleteAccount(t, alice);

		expect(await remaining(t)).toEqual(nothing);
	});

	it("leaves other accounts alone", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		const bob = await signIn(t, "bob@example.com");
		await addChat(t, bob, bob.workspace, 1);
		await bob.as.mutation(api.secrets.put, {
			workspaceId: bob.workspace,
			secret: { key: "REPL_TOKEN", value: "kept", description: "" },
		});

		await deleteAccount(t, alice);

		const left = await remaining(t);
		expect(left.users.map((u) => u._id)).toEqual([bob.user]);
		expect(left.workspaces.map((w) => w._id)).toEqual([bob.workspace]);
		expect(left.chats).toHaveLength(1);
		expect(left.messages).toHaveLength(1);
		expect(left.secrets).toHaveLength(1);
	});
});

describe("removing a user", () => {
	it("takes their preferences with them", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		await alice.as.mutation(api.preferences.put, {
			preferences: { theme: "dusk", themeUses: {} },
		});

		await t.mutation(internal.users.purge, { userId: alice.user });

		const left = await t.run(
			async (ctx) => await ctx.db.query("preferences").collect(),
		);
		expect(left).toEqual([]);
	});
});
