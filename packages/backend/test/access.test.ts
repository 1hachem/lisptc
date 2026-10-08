import type { CataloguedChoice } from "@repo/shared/providers";
import { describe, expect, it } from "vitest";
import { api, internal } from "../convex/_generated/api.js";
import * as messages from "../convex/messages.ts";
import { harness, signIn } from "./helpers.ts";

describe("workspace access", () => {
	it("lists only the workspaces a user owns", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		await signIn(t, "bob@example.com");
		const listed = await alice.as.query(api.workspaces.list, {});
		expect(listed.map((w) => w._id)).toEqual([alice.workspace]);
	});

	it("refuses a workspace owned by someone else", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		const bob = await signIn(t, "bob@example.com");
		await expect(
			alice.as.query(api.workspaces.get, { workspaceId: bob.workspace }),
		).rejects.toThrow();
	});

	it("refuses an unauthenticated caller", async () => {
		const t = harness();
		await signIn(t, "alice@example.com");
		await expect(t.query(api.workspaces.list, {})).rejects.toThrow();
	});
});

describe("workspace model", () => {
	const model = {
		provider: "openrouter",
		model: "google/gemma-4-31b-it",
	} as const;

	it("has none until one is chosen", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		const got = await alice.as.query(api.workspaces.get, {
			workspaceId: alice.workspace,
		});
		expect(got.model).toBeUndefined();
	});

	it("keeps the model a workspace was given, and the latest one wins", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		await alice.as.mutation(api.workspaces.setModel, {
			workspaceId: alice.workspace,
			model,
		});
		const next = {
			provider: "digitalocean",
			model: "gemma-4-31B-it",
		} as const;
		await alice.as.mutation(api.workspaces.setModel, {
			workspaceId: alice.workspace,
			model: next,
		});
		const got = await alice.as.query(api.workspaces.get, {
			workspaceId: alice.workspace,
		});
		expect(got.model).toEqual(next);
	});

	it("refuses choosing the model of another user's workspace", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		const bob = await signIn(t, "bob@example.com");
		await expect(
			alice.as.mutation(api.workspaces.setModel, {
				workspaceId: bob.workspace,
				model,
			}),
		).rejects.toThrow();
	});

	it("refuses a model the catalog does not offer", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		for (const choice of [
			{ provider: "openrouter", model: " " },
			{ provider: "openrouter", model: "anthropic/claude-opus-4" },
			{ provider: "nowhere", model: "google/gemma-4-31b-it" },
		]) {
			await expect(
				alice.as.mutation(api.workspaces.setModel, {
					workspaceId: alice.workspace,
					model: choice as CataloguedChoice,
				}),
			).rejects.toThrow(/Validator error/);
		}
	});
});

describe("chat access", () => {
	it("refuses reading another user's chat", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		const bob = await signIn(t, "bob@example.com");
		const chatId = await bob.as.mutation(api.chats.create, {
			workspaceId: bob.workspace,
		});
		await expect(alice.as.query(api.chats.get, { chatId })).rejects.toThrow();
		await expect(
			alice.as.query(api.messages.transcript, { chatId }),
		).rejects.toThrow();
	});

	it("refuses appending to another user's chat", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		const bob = await signIn(t, "bob@example.com");
		const chatId = await bob.as.mutation(api.chats.create, {
			workspaceId: bob.workspace,
		});
		await expect(
			t.mutation(internal.messages.append, {
				subject: alice.subject,
				chatId,
				messages: [{ type: "human", content: "hello" }],
			}),
		).rejects.toThrow();
	});

	it("refuses annotating a message in another user's chat", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		const bob = await signIn(t, "bob@example.com");
		const chatId = await bob.as.mutation(api.chats.create, {
			workspaceId: bob.workspace,
		});
		await t.mutation(internal.messages.append, {
			subject: bob.subject,
			chatId,
			messages: [{ id: "w1", type: "tool", content: "one" }],
		});
		await expect(
			t.mutation(internal.messages.annotate, {
				subject: alice.subject,
				chatId,
				id: "w1",
				kwargs: { extra: true },
			}),
		).rejects.toThrow();
		await expect(
			t.mutation(internal.messages.annotate, {
				subject: "nobody",
				chatId,
				id: "w1",
				kwargs: { extra: true },
			}),
		).rejects.toThrow();
		const [row] = await bob.as.query(api.messages.transcript, { chatId });
		expect(row.kwargs).toBeUndefined();
	});

	it("refuses writing a message from the browser, even to the owner's chat", () => {
		expect(messages.append.isInternal).toBe(true);
		expect(messages.annotate.isInternal).toBe(true);
	});

	it("hides an archived chat from the list", async () => {
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
		await alice.as.mutation(api.chats.archive, { chatId: gone });
		const listed = await alice.as.query(api.chats.list, {
			workspaceId: alice.workspace,
		});
		expect(listed.map((c) => c._id)).toEqual([kept]);
	});
});

describe("messages", () => {
	it("numbers appended messages in order", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		const chatId = await alice.as.mutation(api.chats.create, {
			workspaceId: alice.workspace,
		});
		await t.mutation(internal.messages.append, {
			subject: alice.subject,
			chatId,
			messages: [{ type: "human", content: "one" }],
		});
		await t.mutation(internal.messages.append, {
			subject: alice.subject,
			chatId,
			messages: [
				{ type: "ai", content: "two" },
				{ type: "tool", content: "three", kwargs: { ui: { kind: "text" } } },
			],
		});
		const transcript = await alice.as.query(api.messages.transcript, {
			chatId,
		});
		expect(transcript.map((m) => [m.seq, m.type, m.content])).toEqual([
			[0, "human", "one"],
			[1, "ai", "two"],
			[2, "tool", "three"],
		]);
		expect(transcript[2].kwargs).toEqual({ ui: { kind: "text" } });
	});

	it("keeps the wire id an appended message was sent with", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		const chatId = await alice.as.mutation(api.chats.create, {
			workspaceId: alice.workspace,
		});
		await t.mutation(internal.messages.append, {
			subject: alice.subject,
			chatId,
			messages: [
				{ id: "w1", type: "tool", content: "one" },
				{ type: "human", content: "two" },
			],
		});
		const transcript = await alice.as.query(api.messages.transcript, {
			chatId,
		});
		expect(transcript.map((m) => m.wireId)).toEqual(["w1", undefined]);
	});

	it("deep-merges an annotation into a message's kwargs by its wire id", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		const chatId = await alice.as.mutation(api.chats.create, {
			workspaceId: alice.workspace,
		});
		await t.mutation(internal.messages.append, {
			subject: alice.subject,
			chatId,
			messages: [
				{
					id: "w1",
					type: "tool",
					content: "one",
					kwargs: {
						display: "shown",
						nested: { list: [1, 2], kept: "yes", inner: { a: 1 } },
					},
				},
			],
		});
		await t.mutation(internal.messages.annotate, {
			subject: alice.subject,
			chatId,
			id: "w1",
			kwargs: { nested: { list: [3], inner: { b: 2 } }, added: 1 },
		});
		const [row] = await alice.as.query(api.messages.transcript, { chatId });
		expect(row.kwargs).toEqual({
			display: "shown",
			nested: { list: [3], kept: "yes", inner: { a: 1, b: 2 } },
			added: 1,
		});
	});

	it("refuses annotating a message the chat does not hold", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		const chatId = await alice.as.mutation(api.chats.create, {
			workspaceId: alice.workspace,
		});
		await expect(
			t.mutation(internal.messages.annotate, {
				subject: alice.subject,
				chatId,
				id: "missing",
				kwargs: { added: 1 },
			}),
		).rejects.toThrow(/MESSAGE_NOT_FOUND/);
	});

	it("stamps the chat with its last activity", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		const chatId = await alice.as.mutation(api.chats.create, {
			workspaceId: alice.workspace,
		});
		await t.mutation(internal.messages.append, {
			subject: alice.subject,
			chatId,
			messages: [{ type: "human", content: "one" }],
		});
		const chat = await alice.as.query(api.chats.get, { chatId });
		expect(chat.lastMessageAt).toBeTypeOf("number");
	});
});

describe("permissions access", () => {
	it("keeps a workspace's config to its owner", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		const bob = await signIn(t, "bob@example.com");
		await bob.as.mutation(api.permissions.put, {
			workspaceId: bob.workspace,
			source: "(permission/deny eval)",
		});
		expect(
			await bob.as.query(api.permissions.get, { workspaceId: bob.workspace }),
		).toBe("(permission/deny eval)");
		await expect(
			alice.as.query(api.permissions.get, { workspaceId: bob.workspace }),
		).rejects.toThrow();
		await expect(
			alice.as.mutation(api.permissions.put, {
				workspaceId: bob.workspace,
				source: "(permission/default allow)",
			}),
		).rejects.toThrow();
		await expect(
			t.query(api.permissions.get, { workspaceId: bob.workspace }),
		).rejects.toThrow();
	});

	it("holds one config per workspace, replaced on save", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		await alice.as.mutation(api.permissions.put, {
			workspaceId: alice.workspace,
			source: "(permission/deny eval)",
		});
		await alice.as.mutation(api.permissions.put, {
			workspaceId: alice.workspace,
			source: "(permission/ask eval)",
		});
		expect(
			await alice.as.query(api.permissions.get, {
				workspaceId: alice.workspace,
			}),
		).toBe("(permission/ask eval)");
		const rows = await t.run((ctx) => ctx.db.query("permissions").collect());
		expect(rows).toHaveLength(1);
	});
});

describe("secret access", () => {
	it("refuses listing another user's secrets", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		const bob = await signIn(t, "bob@example.com");
		await bob.as.mutation(api.secrets.put, {
			workspaceId: bob.workspace,
			secret: { key: "REPL_TOKEN", value: "bob's", description: "" },
		});
		await expect(
			alice.as.query(api.secrets.list, { workspaceId: bob.workspace }),
		).rejects.toThrow();
	});

	it("finds a pending login by its state for its owner only", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		const bob = await signIn(t, "bob@example.com");
		await bob.as.mutation(api.oauth.put, {
			workspaceId: bob.workspace,
			serverKey: "https://sheets.example.com",
			record: "{}",
			pendingState: "bob-state",
		});
		expect(
			await bob.as.query(api.oauth.pendingFor, { state: "bob-state" }),
		).toEqual({
			workspaceId: bob.workspace,
			serverKey: "https://sheets.example.com",
		});
		expect(
			await alice.as.query(api.oauth.pendingFor, { state: "bob-state" }),
		).toBeNull();
	});

	it("refuses writing into another user's workspace", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		const bob = await signIn(t, "bob@example.com");
		await expect(
			alice.as.mutation(api.secrets.put, {
				workspaceId: bob.workspace,
				secret: { key: "REPL_TOKEN", value: "stolen", description: "" },
			}),
		).rejects.toThrow();
		await expect(
			alice.as.mutation(api.secrets.remove, {
				workspaceId: bob.workspace,
				key: "REPL_TOKEN",
			}),
		).rejects.toThrow();
	});

	it("refuses a key without the REPL_ prefix", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		await expect(
			alice.as.mutation(api.secrets.put, {
				workspaceId: alice.workspace,
				secret: { key: "TOKEN", value: "unprefixed", description: "" },
			}),
		).rejects.toThrow();
	});

	it("keeps one workspace's secrets out of another's", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		const other = await alice.as.mutation(api.workspaces.create, {
			name: "other",
		});
		await alice.as.mutation(api.secrets.put, {
			workspaceId: alice.workspace,
			secret: { key: "REPL_TOKEN", value: "first", description: "" },
		});

		const listed = await alice.as.query(api.secrets.list, {
			workspaceId: other,
		});
		expect(listed).toEqual([]);
	});

	it("replaces a secret rather than adding a second row", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		await alice.as.mutation(api.secrets.put, {
			workspaceId: alice.workspace,
			secret: { key: "REPL_TOKEN", value: "first", description: "" },
		});
		await alice.as.mutation(api.secrets.put, {
			workspaceId: alice.workspace,
			secret: { key: "REPL_TOKEN", value: "second", description: "again" },
		});

		const listed = await alice.as.query(api.secrets.list, {
			workspaceId: alice.workspace,
		});
		expect(listed.map((s) => [s.key, s.value, s.description])).toEqual([
			["REPL_TOKEN", "second", "again"],
		]);
	});
});

describe("oauth record access", () => {
	it("refuses reading another user's record", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		const bob = await signIn(t, "bob@example.com");
		await bob.as.mutation(api.oauth.put, {
			workspaceId: bob.workspace,
			serverKey: "https://sheets.example.com",
			record: JSON.stringify({ tokens: { access_token: "bob's" } }),
		});
		await expect(
			alice.as.query(api.oauth.get, {
				workspaceId: bob.workspace,
				serverKey: "https://sheets.example.com",
			}),
		).rejects.toThrow();
	});

	it("refuses writing into another user's workspace", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		const bob = await signIn(t, "bob@example.com");
		await expect(
			alice.as.mutation(api.oauth.put, {
				workspaceId: bob.workspace,
				serverKey: "https://sheets.example.com",
				record: "{}",
			}),
		).rejects.toThrow();
		await expect(
			alice.as.mutation(api.oauth.remove, {
				workspaceId: bob.workspace,
				serverKey: "https://sheets.example.com",
			}),
		).rejects.toThrow();
	});

	it("keeps one workspace's record out of another's", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		const other = await alice.as.mutation(api.workspaces.create, {
			name: "other",
		});
		await alice.as.mutation(api.oauth.put, {
			workspaceId: alice.workspace,
			serverKey: "https://sheets.example.com",
			record: JSON.stringify({ tokens: { access_token: "mine" } }),
		});

		expect(
			await alice.as.query(api.oauth.get, {
				workspaceId: other,
				serverKey: "https://sheets.example.com",
			}),
		).toBeNull();
	});
});
