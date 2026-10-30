import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../convex/_generated/api.js";
import { POINTER_TTL_MS, TOUR_TTL_MS } from "../convex/limits.ts";
import { harness, signIn } from "./helpers.ts";

afterEach(() => {
	vi.useRealTimers();
});

const steps = [
	{
		anchor: "knowledge/upload",
		say: "drop a pdf here",
		until: "click" as const,
	},
	{ say: "now ask me about it", until: "next" as const },
];

async function touring() {
	const t = harness();
	const alice = await signIn(t, "alice@example.com");
	const chatId = await alice.as.mutation(api.chats.create, {
		workspaceId: alice.workspace,
	});
	const start = (tourId: string) =>
		alice.as.mutation(api.tours.start, {
			chatId,
			tourId,
			steps,
			done: "a1",
			skip: "a2",
		});
	const active = async () => {
		const tour = await alice.as.query(api.tours.active, {});
		if (tour === null) throw new Error("no active tour");
		return tour;
	};
	return { t, alice, chatId, start, active };
}

describe("a tour", () => {
	it("walks its steps and records the user finished it", async () => {
		const { alice, start, active } = await touring();
		await start("upload-files");
		const tour = await active();
		expect(tour).toMatchObject({ tourId: "upload-files", current: 0 });
		expect(
			await alice.as.query(api.tours.finished, { tourId: "upload-files" }),
		).toBe(false);
		await alice.as.mutation(api.tours.advance, { tour: tour._id, from: 0 });
		await alice.as.mutation(api.tours.advance, { tour: tour._id, from: 0 });
		expect((await active()).current).toBe(1);
		await alice.as.mutation(api.tours.advance, { tour: tour._id, from: 1 });
		expect(await alice.as.query(api.tours.active, {})).toBeNull();
		expect(
			await alice.as.query(api.tours.finished, { tourId: "upload-files" }),
		).toBe(true);
	});

	it("is not finished when the user skips it", async () => {
		const { alice, start, active } = await touring();
		await start("upload-files");
		await alice.as.mutation(api.tours.skip, { tour: (await active())._id });
		expect(await alice.as.query(api.tours.active, {})).toBeNull();
		expect(
			await alice.as.query(api.tours.finished, { tourId: "upload-files" }),
		).toBe(false);
	});

	it("refuses a step on an anchor the app does not mount", async () => {
		const { alice, chatId } = await touring();
		await expect(
			alice.as.mutation(api.tours.start, {
				chatId,
				tourId: "t",
				steps: [{ anchor: "nowhere", say: "x", until: "next" }],
			}),
		).rejects.toThrow(/TOUR_INVALID/);
	});

	it("pauses the one on screen when another starts", async () => {
		const { start, active } = await touring();
		await start("first");
		await start("second");
		expect((await active()).tourId).toBe("second");
	});

	it("pauses when the user sends a new message", async () => {
		const { alice, chatId, start } = await touring();
		await start("upload-files");
		await alice.as.mutation(api.messages.append, {
			chatId,
			messages: [{ id: "h1", type: "human", content: "never mind" }],
		});
		expect(await alice.as.query(api.tours.active, {})).toBeNull();
	});

	it("carries the button labels the agent gave", async () => {
		const { alice, chatId, active } = await touring();
		await alice.as.mutation(api.tours.start, {
			chatId,
			tourId: "hello",
			steps: [{ say: "hi", until: "next" }],
			labels: { done: "got it" },
		});
		expect((await active()).labels).toEqual({ done: "got it" });
		await expect(
			alice.as.mutation(api.tours.start, {
				chatId,
				tourId: "hello",
				steps: [{ say: "hi", until: "next" }],
				labels: { done: "" },
			}),
		).rejects.toThrow(/TOUR_INVALID/);
	});

	it("stops moving once it expired", async () => {
		vi.useFakeTimers();
		const { alice, start, active } = await touring();
		await start("upload-files");
		const tour = await active();
		vi.advanceTimersByTime(TOUR_TTL_MS + 1);
		await alice.as.mutation(api.tours.advance, { tour: tour._id, from: 0 });
		expect(await alice.as.query(api.tours.active, {})).toBeNull();
	});
});

describe("a pointer", () => {
	it("shows the latest one, and only for a moment", async () => {
		vi.useFakeTimers();
		const { alice, chatId } = await touring();
		expect(await alice.as.query(api.tours.pointer, {})).toBeNull();
		await alice.as.mutation(api.tours.point, {
			chatId,
			anchor: "composer",
			mark: "arrow",
			size: "medium",
			click: false,
		});
		await alice.as.mutation(api.tours.point, {
			chatId,
			anchor: "account",
			mark: "oval",
			size: "medium",
			click: false,
			open: "account",
		});
		expect(await alice.as.query(api.tours.pointer, {})).toMatchObject({
			anchor: "account",
			mark: "oval",
			size: "medium",
			click: false,
			open: "account",
		});
		vi.advanceTimersByTime(POINTER_TTL_MS + 1);
		expect(await alice.as.query(api.tours.pointer, {})).toBeNull();
	});

	it("leaves no row behind once it expired", async () => {
		vi.useFakeTimers();
		const { alice, chatId, t } = await touring();
		await alice.as.mutation(api.tours.point, {
			chatId,
			anchor: "composer",
			mark: "arrow",
			size: "medium",
			click: false,
		});
		await t.finishAllScheduledFunctions(vi.runAllTimers);
		const left = await t.run(
			async (ctx) => await ctx.db.query("pointers").collect(),
		);
		expect(left).toEqual([]);
	});

	it("refuses an anchor or a page the app does not have", async () => {
		const { alice, chatId } = await touring();
		await expect(
			alice.as.mutation(api.tours.point, {
				chatId,
				anchor: "nowhere",
				mark: "arrow",
				size: "medium",
				click: false,
			}),
		).rejects.toThrow(/POINTER_INVALID/);
		await expect(
			alice.as.mutation(api.tours.point, {
				chatId,
				anchor: "account",
				mark: "arrow",
				size: "medium",
				click: false,
				open: "billing",
			}),
		).rejects.toThrow(/POINTER_INVALID/);
	});
});
