import type { CataloguedChoice } from "@repo/shared/providers";
import { describe, expect, it, vi } from "vitest";
import { api, internal } from "../convex/_generated/api.js";
import {
	DEFAULT_HIDDEN,
	DEFAULT_SEND_LABEL,
	DEFAULT_TOGGLES,
} from "../convex/lib/preferenceDefaults.ts";
import {
	MAX_PREFERENCES_BYTES,
	MAX_README_BYTES,
	STREAMING_LEASE_MS,
} from "../convex/limits.ts";
import { harness, signIn } from "./helpers.ts";

describe("repl checkpoint access", () => {
	it("refuses to open another user's repl", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		const bob = await signIn(t, "bob@example.com");
		const chatId = await alice.as.mutation(api.chats.create, {
			workspaceId: alice.workspace,
		});
		await expect(bob.as.mutation(api.repls.open, { chatId })).rejects.toThrow();
	});

	it("refuses a repl whose chat was removed", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		const chatId = await alice.as.mutation(api.chats.create, {
			workspaceId: alice.workspace,
		});
		const replId = await alice.as.mutation(api.repls.open, { chatId });
		await alice.as.mutation(api.chats.remove, { chatId });
		await expect(
			t.mutation(internal.repls.record, {
				replId,
				whole: true,
				chunks: ["{}"],
			}),
		).rejects.toThrow();
	});

	it("refuses to fork another user's chat", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		const bob = await signIn(t, "bob@example.com");
		const chatId = await alice.as.mutation(api.chats.create, {
			workspaceId: alice.workspace,
		});
		await alice.as.mutation(api.messages.append, {
			chatId,
			messages: [{ id: "h1", type: "human", content: "hi" }],
		});
		await expect(
			bob.as.mutation(api.chats.fork, { chatId, messageId: "h1" }),
		).rejects.toThrow();
	});
});

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

describe("workspace icon", () => {
	it("lets the owner pick one, and no one else", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		const bob = await signIn(t, "bob@example.com");
		await alice.as.mutation(api.workspaces.setIcon, {
			workspaceId: alice.workspace,
			icon: "rocket",
		});
		expect(
			(
				await alice.as.query(api.workspaces.get, {
					workspaceId: alice.workspace,
				})
			).icon,
		).toBe("rocket");
		await expect(
			bob.as.mutation(api.workspaces.setIcon, {
				workspaceId: alice.workspace,
				icon: "leaf",
			}),
		).rejects.toThrow();
	});

	it("refuses an icon the app cannot draw", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		await expect(
			alice.as.mutation(api.workspaces.setIcon, {
				workspaceId: alice.workspace,
				icon: "unicorn" as "rocket",
			}),
		).rejects.toThrow();
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
			alice.as.mutation(api.messages.append, {
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
		await bob.as.mutation(api.messages.append, {
			chatId,
			messages: [{ id: "w1", type: "tool", content: "one" }],
		});
		await expect(
			alice.as.mutation(api.messages.annotate, {
				chatId,
				id: "w1",
				kwargs: { extra: true },
			}),
		).rejects.toThrow();
		await expect(
			t.mutation(api.messages.annotate, {
				chatId,
				id: "w1",
				kwargs: { extra: true },
			}),
		).rejects.toThrow();
		const [row] = await bob.as.query(api.messages.transcript, { chatId });
		expect(row.kwargs).toBeUndefined();
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
		expect(listed.chats.map((c) => c._id)).toEqual([kept]);
	});
});

describe("messages", () => {
	it("numbers appended messages in order", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		const chatId = await alice.as.mutation(api.chats.create, {
			workspaceId: alice.workspace,
		});
		await alice.as.mutation(api.messages.append, {
			chatId,
			messages: [{ type: "human", content: "one" }],
		});
		await alice.as.mutation(api.messages.append, {
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
		await alice.as.mutation(api.messages.append, {
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
		await alice.as.mutation(api.messages.append, {
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
		await alice.as.mutation(api.messages.annotate, {
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
			alice.as.mutation(api.messages.annotate, {
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
		await alice.as.mutation(api.messages.append, {
			chatId,
			messages: [{ type: "human", content: "one" }],
		});
		const chat = await alice.as.query(api.chats.get, { chatId });
		expect(chat.lastMessageAt).toBeTypeOf("number");
	});

	it("lists what was sent in every chat of a workspace, oldest first", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		const first = await alice.as.mutation(api.chats.create, {
			workspaceId: alice.workspace,
		});
		const second = await alice.as.mutation(api.chats.create, {
			workspaceId: alice.workspace,
		});
		await alice.as.mutation(api.messages.append, {
			chatId: first,
			messages: [
				{ type: "human", content: "one" },
				{ type: "ai", content: "reply" },
			],
		});
		await alice.as.mutation(api.messages.append, {
			chatId: second,
			messages: [{ type: "human", content: "two" }],
		});
		await alice.as.mutation(api.messages.append, {
			chatId: first,
			messages: [{ type: "human", content: "three" }],
		});
		const sent = await alice.as.query(api.messages.sent, {
			workspaceId: alice.workspace,
		});
		expect(sent).toEqual(["one", "two", "three"]);
	});

	it("refuses listing what was sent in another user's workspace", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		const bob = await signIn(t, "bob@example.com");
		await expect(
			alice.as.query(api.messages.sent, { workspaceId: bob.workspace }),
		).rejects.toThrow();
	});
});

describe("panel layout access", () => {
	const tab = (name: string) => ({
		id: `file:knowledge/${name}`,
		content: { kind: "file" as const, folder: "knowledge" as const, name },
	});
	const pane = (id: string) => ({
		kind: "pane" as const,
		id,
		tabs: [tab(`${id}.md`)],
		active: `file:knowledge/${id}.md`,
	});
	const split = (
		id: string,
		direction: "row" | "column",
		children: string[],
	) => ({
		kind: "split" as const,
		id,
		direction,
		children,
		sizes: children.map(() => 100 / children.length),
	});
	const layout = (columns: number, rows = 1) => {
		const ids = Array.from({ length: columns }, (_, c) => `c${c}`);
		const cells = ids.flatMap((column) =>
			Array.from({ length: rows }, (_, r) => `${column}-${r}`),
		);
		return {
			root: "root",
			focused: null,
			nodes: [
				split("root", "row", ids),
				...ids.map((column) =>
					split(
						column,
						"column",
						cells.filter((cell) => cell.startsWith(`${column}-`)),
					),
				),
				...cells.map(pane),
			],
		};
	};

	it("keeps a workspace's layout to its owner", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		const bob = await signIn(t, "bob@example.com");
		await bob.as.mutation(api.layouts.put, {
			workspaceId: bob.workspace,
			layout: layout(2),
		});
		expect(
			await bob.as.query(api.layouts.get, { workspaceId: bob.workspace }),
		).toEqual(layout(2));
		await expect(
			alice.as.query(api.layouts.get, { workspaceId: bob.workspace }),
		).rejects.toThrow();
		await expect(
			alice.as.mutation(api.layouts.put, {
				workspaceId: bob.workspace,
				layout: layout(1),
			}),
		).rejects.toThrow();
	});

	it("holds one layout per workspace, replaced on save, and none before the first", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		expect(
			await alice.as.query(api.layouts.get, { workspaceId: alice.workspace }),
		).toBeNull();
		await alice.as.mutation(api.layouts.put, {
			workspaceId: alice.workspace,
			layout: layout(1),
		});
		await alice.as.mutation(api.layouts.put, {
			workspaceId: alice.workspace,
			layout: layout(3, 3),
		});
		const rows = await t.run((ctx) => ctx.db.query("layouts").collect());
		expect(rows).toHaveLength(1);
		expect(
			await alice.as.query(api.layouts.get, { workspaceId: alice.workspace }),
		).toEqual(layout(3, 3));
	});

	it("reads a layout stored in the old shape as none", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		await t.run((ctx) =>
			ctx.db.insert("layouts", {
				workspaceId: alice.workspace,
				layout: { direction: "row", focused: null, groups: [] },
			}),
		);
		expect(
			await alice.as.query(api.layouts.get, { workspaceId: alice.workspace }),
		).toBeNull();
	});

	it("refuses more than three splits either way", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		await expect(
			alice.as.mutation(api.layouts.put, {
				workspaceId: alice.workspace,
				layout: layout(4),
			}),
		).rejects.toThrow(/LAYOUT_TOO_MANY_SPLITS/);
		await expect(
			alice.as.mutation(api.layouts.put, {
				workspaceId: alice.workspace,
				layout: layout(1, 4),
			}),
		).rejects.toThrow(/LAYOUT_TOO_MANY_SPLITS/);
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

const DEFAULTS = {
	...DEFAULT_TOGGLES,
	sendLabel: DEFAULT_SEND_LABEL,
	hidden: DEFAULT_HIDDEN,
};

describe("preferences access", () => {
	it("keeps a user's preferences to that user", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		const bob = await signIn(t, "bob@example.com");
		const preferences = { theme: "dusk", font: "mono", themeUses: { dusk: 2 } };
		await bob.as.mutation(api.preferences.put, { preferences });
		expect(await bob.as.query(api.preferences.get, {})).toEqual({
			...DEFAULTS,
			...preferences,
		});
		expect(await alice.as.query(api.preferences.get, {})).toEqual(DEFAULTS);
		await expect(t.query(api.preferences.get, {})).rejects.toThrow();
	});

	it("merges each save into one row per user", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		await alice.as.mutation(api.preferences.put, {
			preferences: { theme: "dusk", channels: { lisp: true } },
		});
		await alice.as.mutation(api.preferences.put, {
			preferences: { font: "mono", channels: { lisp: false } },
		});
		await alice.as.mutation(api.preferences.put, {
			preferences: { metadata: { tokens: true } },
		});
		expect(await alice.as.query(api.preferences.get, {})).toEqual({
			theme: "dusk",
			font: "mono",
			channels: { ...DEFAULT_TOGGLES.channels, lisp: false },
			metadata: { ...DEFAULT_TOGGLES.metadata, tokens: true },
			input: DEFAULT_TOGGLES.input,
			sendLabel: DEFAULT_SEND_LABEL,
			hidden: DEFAULT_HIDDEN,
		});
		const rows = await t.run((ctx) => ctx.db.query("preferences").collect());
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			channels: { lisp: false },
			metadata: { tokens: true },
		});
		expect(rows[0].input).toBeUndefined();
		expect(rows[0].hidden).toBeUndefined();
	});

	it("hides attachments and the bin until the user shows them", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		expect((await alice.as.query(api.preferences.get, {})).hidden).toEqual([
			"attachments",
			"bin",
		]);
		await alice.as.mutation(api.preferences.put, {
			preferences: { hidden: [] },
		});
		expect((await alice.as.query(api.preferences.get, {})).hidden).toEqual([]);
	});

	it("refuses preferences past the size limit", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		await expect(
			alice.as.mutation(api.preferences.put, {
				preferences: {
					theme: "x".repeat(MAX_PREFERENCES_BYTES),
					themeUses: {},
				},
			}),
		).rejects.toThrow("PREFERENCES_TOO_LARGE");
	});
});

describe("chat listing", () => {
	async function three(t: ReturnType<typeof harness>) {
		const alice = await signIn(t, "alice@example.com");
		for (const title of ["plan q4", "fix login", "login copy"]) {
			await alice.as.mutation(api.chats.create, {
				workspaceId: alice.workspace,
				title,
			});
		}
		return alice;
	}

	it("pages by limit and says when more remain", async () => {
		const t = harness();
		const alice = await three(t);
		const first = await alice.as.query(api.chats.list, {
			workspaceId: alice.workspace,
			limit: 2,
		});
		expect(first.chats).toHaveLength(2);
		expect(first.more).toBe(true);
		const all = await alice.as.query(api.chats.list, {
			workspaceId: alice.workspace,
			limit: 3,
		});
		expect(all.chats).toHaveLength(3);
		expect(all.more).toBe(false);
	});

	it("lists a chat with no messages above older ones", async () => {
		const t = harness();
		const alice = await three(t);
		const older = await alice.as.mutation(api.chats.create, {
			workspaceId: alice.workspace,
			title: "older",
		});
		await alice.as.mutation(api.messages.append, {
			chatId: older,
			messages: [{ type: "human", content: "hello" }],
		});
		const fresh = await alice.as.mutation(api.chats.create, {
			workspaceId: alice.workspace,
			title: "fresh",
		});
		const { chats } = await alice.as.query(api.chats.list, {
			workspaceId: alice.workspace,
		});
		expect(chats[0]?._id).toBe(fresh);
	});

	it("hands back the same unsent draft however often a new chat is opened", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		const draft = await alice.as.mutation(api.chats.draft, {
			workspaceId: alice.workspace,
		});
		expect(
			await alice.as.mutation(api.chats.draft, {
				workspaceId: alice.workspace,
			}),
		).toBe(draft);
		const rows = await t.run((ctx) => ctx.db.query("chats").collect());
		expect(rows).toHaveLength(1);
	});

	it("keeps an unsent draft out of the list until its first message", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		const draft = await alice.as.mutation(api.chats.draft, {
			workspaceId: alice.workspace,
		});
		const listed = async () =>
			(
				await alice.as.query(api.chats.list, { workspaceId: alice.workspace })
			).chats.map((c) => c._id);
		expect(await listed()).toEqual([]);
		await alice.as.mutation(api.messages.append, {
			chatId: draft,
			messages: [{ type: "human", content: "hello" }],
		});
		expect(await listed()).toEqual([draft]);
	});

	it("opens a fresh draft once the last one has been sent", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		const sent = await alice.as.mutation(api.chats.draft, {
			workspaceId: alice.workspace,
		});
		await alice.as.mutation(api.messages.append, {
			chatId: sent,
			messages: [{ type: "human", content: "hello" }],
		});
		expect(
			await alice.as.mutation(api.chats.draft, {
				workspaceId: alice.workspace,
			}),
		).not.toBe(sent);
	});

	it("keeps each user's draft to that user", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		const bob = await signIn(t, "bob@example.com");
		const own = await alice.as.mutation(api.chats.draft, {
			workspaceId: alice.workspace,
		});
		await expect(
			bob.as.mutation(api.chats.draft, { workspaceId: alice.workspace }),
		).rejects.toThrow();
		expect(
			await alice.as.mutation(api.chats.draft, {
				workspaceId: alice.workspace,
			}),
		).toBe(own);
	});

	describe("status", () => {
		const asking = {
			type: "tool" as const,
			content: "held",
			id: "w1",
			kwargs: {
				asks: { open: [{ id: "a1", title: "run?", prompt: "", choices: [] }] },
			},
		};

		async function opened(t: ReturnType<typeof harness>) {
			const alice = await signIn(t, "alice@example.com");
			const chatId = await alice.as.mutation(api.chats.create, {
				workspaceId: alice.workspace,
			});
			await alice.as.mutation(api.messages.append, {
				chatId,
				messages: [{ type: "human", content: "go" }],
			});
			await alice.as.mutation(api.chats.start, { chatId });
			const status = async () =>
				(await alice.as.query(api.chats.get, { chatId })).status;
			return { alice, chatId, status };
		}

		it("streams from start and goes idle when the turn settles", async () => {
			const { alice, chatId, status } = await opened(harness());
			expect(await status()).toBe("streaming");
			await alice.as.mutation(api.chats.settle, { chatId });
			expect(await status()).toBeUndefined();
		});

		it("keeps why a turn failed until the next one starts", async () => {
			const { alice, chatId, status } = await opened(harness());
			await alice.as.mutation(api.chats.settle, {
				chatId,
				failure: "the provider is down",
			});
			const chat = await alice.as.query(api.chats.get, { chatId });
			expect(chat).toMatchObject({
				status: "errored",
				failure: "the provider is down",
			});
			await alice.as.mutation(api.chats.start, { chatId });
			expect(await status()).toBe("streaming");
			expect(
				(await alice.as.query(api.chats.get, { chatId })).failure,
			).toBeUndefined();
		});

		it("errors a turn that never settles once its lease runs out", async () => {
			vi.useFakeTimers();
			const t = harness();
			const { alice, chatId } = await opened(t);
			await t.finishAllScheduledFunctions(vi.runAllTimers);
			expect(await alice.as.query(api.chats.get, { chatId })).toMatchObject({
				status: "errored",
				failure: "the turn stopped answering",
			});
			vi.useRealTimers();
		});

		it("leaves a turn that settled, or started again, to its own lease", async () => {
			vi.useFakeTimers();
			const t = harness();
			const { alice, chatId, status } = await opened(t);
			await alice.as.mutation(api.chats.settle, { chatId });
			await t.finishAllScheduledFunctions(vi.runAllTimers);
			expect(await status()).toBeUndefined();

			await alice.as.mutation(api.chats.start, { chatId });
			vi.advanceTimersByTime(STREAMING_LEASE_MS / 2);
			await alice.as.mutation(api.chats.start, { chatId });
			vi.advanceTimersByTime(STREAMING_LEASE_MS / 2 + 1);
			await t.finishInProgressScheduledFunctions();
			expect(await status()).toBe("streaming");
			vi.useRealTimers();
		});

		it("waits on an open ask until it is answered", async () => {
			const { alice, chatId, status } = await opened(harness());
			await alice.as.mutation(api.messages.append, {
				chatId,
				messages: [asking],
			});
			await alice.as.mutation(api.chats.settle, { chatId });
			expect(await status()).toBe("waiting");
			await alice.as.mutation(api.messages.annotate, {
				chatId,
				id: "w1",
				kwargs: { asks: { answered: { a1: { accepted: true, label: "ok" } } } },
			});
			expect(await status()).toBeUndefined();
		});

		it("forgets an ask left open in an earlier turn", async () => {
			const { alice, chatId, status } = await opened(harness());
			await alice.as.mutation(api.messages.append, {
				chatId,
				messages: [asking, { type: "human", content: "never mind" }],
			});
			await alice.as.mutation(api.chats.settle, { chatId });
			expect(await status()).toBeUndefined();
		});
	});

	it("finds chats by title", async () => {
		const t = harness();
		const alice = await three(t);
		const found = await alice.as.query(api.chats.list, {
			workspaceId: alice.workspace,
			search: "login",
		});
		expect(found.chats.map((c) => c.title).sort()).toEqual([
			"fix login",
			"login copy",
		]);
	});
});

describe("readme access", () => {
	it("keeps a workspace's readme to its owner", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		const bob = await signIn(t, "bob@example.com");
		await bob.as.mutation(api.readmes.put, {
			workspaceId: bob.workspace,
			body: "# bob",
		});
		expect(
			await bob.as.query(api.readmes.get, { workspaceId: bob.workspace }),
		).toBe("# bob");
		await expect(
			alice.as.query(api.readmes.get, { workspaceId: bob.workspace }),
		).rejects.toThrow();
		await expect(
			alice.as.mutation(api.readmes.put, {
				workspaceId: bob.workspace,
				body: "# alice was here",
			}),
		).rejects.toThrow();
	});

	it("reads empty until written, then holds one row replaced on save", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		const workspaceId = alice.workspace;
		expect(await alice.as.query(api.readmes.get, { workspaceId })).toBe("");
		await alice.as.mutation(api.readmes.put, { workspaceId, body: "one" });
		await alice.as.mutation(api.readmes.put, { workspaceId, body: "two" });
		expect(await alice.as.query(api.readmes.get, { workspaceId })).toBe("two");
		const rows = await t.run((ctx) => ctx.db.query("readmes").collect());
		expect(rows).toHaveLength(1);
	});

	it("refuses a readme past the size limit", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		await expect(
			alice.as.mutation(api.readmes.put, {
				workspaceId: alice.workspace,
				body: "x".repeat(MAX_README_BYTES + 1),
			}),
		).rejects.toThrow("README_TOO_LARGE");
	});
});

describe("knowledge access", () => {
	it("keeps a workspace's knowledge to its owner", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		const bob = await signIn(t, "bob@example.com");
		await bob.as.mutation(api.knowledge.add, {
			workspaceId: bob.workspace,
			name: "bob.txt",
			storageId: await t.run((ctx) => ctx.storage.store(new Blob(["bob"]))),
		});
		await expect(
			alice.as.query(api.knowledge.get, {
				workspaceId: bob.workspace,
				name: "bob.txt",
			}),
		).rejects.toThrow();
		await expect(
			alice.as.mutation(api.knowledge.remove, {
				workspaceId: bob.workspace,
				name: "bob.txt",
			}),
		).rejects.toThrow();
		expect(
			await bob.as.query(api.knowledge.list, { workspaceId: bob.workspace }),
		).toHaveLength(1);
	});
});

describe("attachments access", () => {
	it("keeps a workspace's attachments to its owner", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		const bob = await signIn(t, "bob@example.com");
		await bob.as.mutation(api.attachments.add, {
			workspaceId: bob.workspace,
			name: "bob.txt",
			storageId: await t.run((ctx) => ctx.storage.store(new Blob(["bob"]))),
		});
		await expect(
			alice.as.query(api.attachments.get, {
				workspaceId: bob.workspace,
				name: "bob.txt",
			}),
		).rejects.toThrow();
		await expect(
			alice.as.mutation(api.attachments.keep, {
				workspaceId: bob.workspace,
				name: "bob.txt",
			}),
		).rejects.toThrow();
		await expect(
			alice.as.mutation(api.attachments.remove, {
				workspaceId: bob.workspace,
				name: "bob.txt",
			}),
		).rejects.toThrow();
		expect(
			await bob.as.query(api.attachments.list, { workspaceId: bob.workspace }),
		).toHaveLength(1);
	});
});

describe("bin access", () => {
	it("keeps a workspace's bin to its owner", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		const bob = await signIn(t, "bob@example.com");
		await bob.as.mutation(api.attachments.add, {
			workspaceId: bob.workspace,
			name: "bob.txt",
			storageId: await t.run((ctx) => ctx.storage.store(new Blob(["bob"]))),
		});
		await bob.as.mutation(api.attachments.remove, {
			workspaceId: bob.workspace,
			name: "bob.txt",
		});
		for (const denied of [
			alice.as.query(api.bin.list, { workspaceId: bob.workspace }),
			alice.as.query(api.bin.get, {
				workspaceId: bob.workspace,
				name: "bob.txt",
			}),
			alice.as.mutation(api.bin.restore, {
				workspaceId: bob.workspace,
				name: "bob.txt",
			}),
			alice.as.mutation(api.bin.remove, {
				workspaceId: bob.workspace,
				name: "bob.txt",
			}),
		])
			await expect(denied).rejects.toThrow();
		expect(
			await bob.as.query(api.bin.list, { workspaceId: bob.workspace }),
		).toHaveLength(1);
	});
});
