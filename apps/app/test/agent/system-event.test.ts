import type { Envelope, PostOptions } from "@repo/ai";
import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { type Method, postJson as send } from "../helpers.ts";

const CHAT = "j57dbngz9ch0dbd3vbc12sygs58ejt2q";
const NOTE = 'I approved (fs/write "a"). Carry on.';

const world = vi.hoisted(() => ({
	posted: [] as {
		chatId: string;
		envelope: Envelope;
		options?: PostOptions;
	}[],
	failed: false,
	answered: [] as unknown[][],
	annotated: [] as unknown[],
	cancelled: [] as [string, string][],
}));

vi.mock("../../server/agent/session.ts", async () => {
	const { createMiddleware } = await import("@tanstack/react-start");
	const { edge } = await import("../../server/agent/edge.ts");
	const session = createMiddleware({ type: "request" }).server(({ next }) =>
		next({ context: { session: { token: "u1", subject: "u1" } } }),
	);
	return {
		authed: [...edge, session],
	};
});

vi.mock("../../server/agent/convex.ts", () => ({
	convexAs: () => ({
		query: async () => ({}),
		mutation: async (_: unknown, args: unknown) => {
			world.annotated.push(args);
		},
	}),
}));

vi.mock("../../server/agent/threads.ts", () => ({
	threads: {},
	post: async (chatId: string, envelope: Envelope, options?: PostOptions) => {
		world.posted.push({ chatId, envelope, options });
		return {
			opened: Promise.resolve(undefined),
			ended: Promise.resolve({ answer: "done." }),
		};
	},
	withdrawPost: async () => true,
	stopThread: async (chatId: string, scope: string) => {
		world.cancelled.push([chatId, scope]);
		return true;
	},
	answer: async (...args: unknown[]) => {
		world.answered.push(args);
		return {
			output: "",
			error: world.failed,
			message: NOTE,
			annotations: { decided: true },
		};
	},
}));

let chat: Method;
let uiAction: Method;
let stop: Method;

beforeAll(async () => {
	process.env.VITE_CONVEX_URL = "http://127.0.0.1:3210";
	process.env.VITE_ENVIRONMENT = "dev";
	process.env.VITE_POSTHOG_KEY = "test";
	process.env.VITE_POSTHOG_SURVEY_ID = "test";
	process.env.CONVEX_URL = "http://127.0.0.1:3210";
	process.env.CONVEX_SITE_URL = "http://127.0.0.1:3211";
	({ turn: chat, stop } = await import("../../server/agent/chat.ts"));
	({ uiAction } = await import("../../server/agent/ui-action.ts"));
});

beforeEach(() => {
	world.posted.length = 0;
	world.failed = false;
	world.answered.length = 0;
	world.annotated.length = 0;
	world.cancelled.length = 0;
});

const decide = (messageId?: string) =>
	send(uiAction, {
		chatId: CHAT,
		messageId,
		action: "permissions/decide",
		values: { id: "r1" },
	});

describe("a ui action", () => {
	test("is answered on the chat's thread tree with the ask it names", async () => {
		const body = (await (await decide("ask-1")).json()) as Record<
			string,
			unknown
		>;
		expect(body.message).toBe(NOTE);
		expect(world.answered).toEqual([
			[CHAT, "permissions/decide", { id: "r1" }, "ask-1"],
		]);
		expect(world.annotated).toEqual([
			{ chatId: CHAT, id: "ask-1", kwargs: { decided: true } },
		]);
		expect(world.posted).toEqual([]);
	});

	test("still annotates what a failed action recorded", async () => {
		world.failed = true;
		await decide("ask-1");
		expect(world.annotated).toEqual([
			expect.objectContaining({ id: "ask-1", kwargs: { decided: true } }),
		]);
	});

	test("stops only the chat's own thread when the user stops it", async () => {
		const response = await send(stop, { chatId: CHAT });
		expect(response.status).toBe(200);
		expect(world.cancelled).toEqual([[CHAT, "thread"]]);
	});

	test("cancels the chat's whole tree when the user stops them all", async () => {
		const response = await send(stop, { chatId: CHAT, scope: "tree" });
		expect(response.status).toBe(200);
		expect(world.cancelled).toEqual([[CHAT, "tree"]]);
	});

	test("refuses a stop scope it does not know", async () => {
		const response = await send(stop, { chatId: CHAT, scope: "siblings" });
		expect(response.ok).toBe(false);
		expect(world.cancelled).toEqual([]);
	});

	test("cannot be sent by the browser as a turn", async () => {
		const response = await send(chat, {
			input: { chatId: CHAT, event: { token: "x" } },
		});
		expect(response.ok).toBe(false);
		expect(world.posted).toEqual([]);
	});
});
