import { str } from "@repo/interpreter/print";
import { Reader } from "@repo/interpreter/reader";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../convex/_generated/api.js";
import { ACTING_ISSUER } from "../convex/lib/acting.ts";
import { MAX_ONBOARDING_BYTES } from "../convex/limits.js";
import {
	ConvexOnboardingStore,
	type OnboardingClient,
} from "../src/onboarding-store.ts";
import { harness, signIn } from "./helpers.ts";

const WELCOME = {
	name: "welcome",
	about: "first look",
	script: '(ui/tour "welcome" (quote (:say "hi")))',
};

describe("onboarding access", () => {
	it("keeps an onboarding in the workspace it was written to", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		const bob = await signIn(t, "bob@example.com");
		await alice.as.mutation(api.onboardings.put, {
			workspaceId: alice.workspace,
			onboarding: WELCOME,
		});

		expect(
			await alice.as.query(api.onboardings.list, {
				workspaceId: alice.workspace,
			}),
		).toEqual([expect.objectContaining({ name: "welcome", status: "new" })]);
		expect(
			await bob.as.query(api.onboardings.list, { workspaceId: bob.workspace }),
		).toEqual([]);
	});

	it("refuses another user's workspace", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		const bob = await signIn(t, "bob@example.com");
		await bob.as.mutation(api.onboardings.put, {
			workspaceId: bob.workspace,
			onboarding: WELCOME,
		});
		await expect(
			alice.as.query(api.onboardings.list, { workspaceId: bob.workspace }),
		).rejects.toThrow();
		await expect(
			alice.as.mutation(api.onboardings.put, {
				workspaceId: bob.workspace,
				onboarding: WELCOME,
			}),
		).rejects.toThrow();
		await expect(
			alice.as.mutation(api.onboardings.mark, {
				workspaceId: bob.workspace,
				name: "welcome",
				status: "done",
			}),
		).rejects.toThrow();
		await expect(
			alice.as.mutation(api.onboardings.remove, {
				workspaceId: bob.workspace,
				name: "welcome",
			}),
		).rejects.toThrow();
	});

	it("refuses an unauthenticated caller", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		await expect(
			t.query(api.onboardings.list, { workspaceId: alice.workspace }),
		).rejects.toThrow();
	});

	it("records progress for the user a thread acts as", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		const thread = t.withIdentity({
			issuer: ACTING_ISSUER,
			subject: alice.user,
			workspaceId: alice.workspace,
		});
		await thread.mutation(api.onboardings.put, {
			workspaceId: alice.workspace,
			onboarding: WELCOME,
		});
		await thread.mutation(api.onboardings.mark, {
			workspaceId: alice.workspace,
			name: "welcome",
			status: "done",
		});

		expect(
			await alice.as.query(api.onboardings.get, {
				workspaceId: alice.workspace,
				name: "welcome",
			}),
		).toMatchObject({ status: "done" });
	});
});

describe("onboarding rows", () => {
	it("replaces the script and keeps the progress", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		const workspaceId = alice.workspace;
		await alice.as.mutation(api.onboardings.put, {
			workspaceId,
			onboarding: WELCOME,
		});
		await alice.as.mutation(api.onboardings.mark, {
			workspaceId,
			name: "welcome",
			status: "started",
		});
		await alice.as.mutation(api.onboardings.put, {
			workspaceId,
			onboarding: { ...WELCOME, script: "(+ 1 2)" },
		});

		expect(await alice.as.query(api.onboardings.list, { workspaceId })).toEqual(
			[expect.objectContaining({ script: "(+ 1 2)", status: "started" })],
		);
	});

	it("refuses to mark one that does not exist", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		await expect(
			alice.as.mutation(api.onboardings.mark, {
				workspaceId: alice.workspace,
				name: "nowhere",
				status: "done",
			}),
		).rejects.toThrow();
	});

	it("refuses a name that is not a slug", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		await expect(
			alice.as.mutation(api.onboardings.put, {
				workspaceId: alice.workspace,
				onboarding: { ...WELCOME, name: "First Chat" },
			}),
		).rejects.toThrow();
	});

	it("refuses one larger than the cap", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		await expect(
			alice.as.mutation(api.onboardings.put, {
				workspaceId: alice.workspace,
				onboarding: {
					...WELCOME,
					script: `"${"x".repeat(MAX_ONBOARDING_BYTES)}"`,
				},
			}),
		).rejects.toThrow();
	});

	it("takes its progress with it when removed", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		const workspaceId = alice.workspace;
		await alice.as.mutation(api.onboardings.put, {
			workspaceId,
			onboarding: WELCOME,
		});
		await alice.as.mutation(api.onboardings.mark, {
			workspaceId,
			name: "welcome",
			status: "done",
		});

		expect(
			await alice.as.mutation(api.onboardings.remove, {
				workspaceId,
				name: "welcome",
			}),
		).toBe(true);
		expect(
			await alice.as.mutation(api.onboardings.remove, {
				workspaceId,
				name: "welcome",
			}),
		).toBe(false);
		expect(
			await t.run((ctx) => ctx.db.query("onboardingProgress").collect()),
		).toEqual([]);
	});
});

describe("removing a workspace", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("takes its onboardings and their progress with it", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		await alice.as.mutation(api.onboardings.put, {
			workspaceId: alice.workspace,
			onboarding: WELCOME,
		});
		await alice.as.mutation(api.onboardings.mark, {
			workspaceId: alice.workspace,
			name: "welcome",
			status: "done",
		});

		await alice.as.mutation(api.workspaces.remove, {
			workspaceId: alice.workspace,
		});
		await t.finishAllScheduledFunctions(vi.runAllTimers);

		expect(
			await t.run(async (ctx) => ({
				onboardings: await ctx.db.query("onboardings").collect(),
				progress: await ctx.db.query("onboardingProgress").collect(),
			})),
		).toEqual({ onboardings: [], progress: [] });
	});
});

describe("the convex onboarding store", () => {
	it("prints the script it writes and reads it back as a form", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		const store = new ConvexOnboardingStore(
			alice.workspace,
			() => alice.as as unknown as OnboardingClient,
		);
		const reader = new Reader();
		reader.push(WELCOME.script);
		const script = reader.read();

		await store.put({ name: "welcome", about: "first look", script });
		await store.mark("welcome", "started");

		const found = await store.get("welcome");
		expect(str(found?.script)).toBe(str(script));
		expect(found?.status).toBe("started");
		expect(await store.get("nowhere")).toBeUndefined();
		expect((await store.all()).map((o) => o.name)).toEqual(["welcome"]);
	});
});
