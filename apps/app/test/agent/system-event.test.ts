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
		mutation: async () => {},
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
	answer: async () => ({
		output: "",
		error: false,
		message: NOTE,
		annotations: { decided: true },
	}),
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
	test("answers with the message the decision produced", async () => {
		const body = (await (await decide("ask-1")).json()) as Record<
			string,
			unknown
		>;
		expect(body.message).toBe(NOTE);
	});

	test("accepts a stop of the chat's own thread and of its whole tree", async () => {
		expect((await send(stop, { chatId: CHAT })).status).toBe(200);
		expect((await send(stop, { chatId: CHAT, scope: "tree" })).status).toBe(
			200,
		);
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
