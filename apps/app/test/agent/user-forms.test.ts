import type { Envelope, PostOptions } from "@repo/ai";
import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { type Method, postJson as send, serve } from "../helpers.ts";

const CHAT = "j57dbngz9ch0dbd3vbc12sygs58ejt2q";

const world = vi.hoisted(() => ({
	posted: [] as {
		chatId: string;
		envelope: Envelope;
		options?: PostOptions;
	}[],
	running: true,
	denied: false,
	watching: [] as { chatId: string; signal: AbortSignal }[],
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
		query: async () => {
			if (world.denied) throw new Error("not your chat");
			return {};
		},
		mutation: async () => {},
	}),
}));

vi.mock("../../server/agent/threads.ts", () => ({
	threads: {},
	post: async (chatId: string, envelope: Envelope, options?: PostOptions) => {
		world.posted.push({ chatId, envelope, options });
		return { ended: Promise.resolve({ answer: "done." }) };
	},
	watchThread: (chatId: string, signal: AbortSignal) => {
		world.watching.push({ chatId, signal });
		return new Response("event: status\ndata: {}\n\n");
	},
	stopThread: () => world.running,
	withdrawPost: async () => true,
}));

let turn: Method;
let steer: Method;
let watch: Method;
let stop: Method;

beforeAll(async () => {
	process.env.VITE_CONVEX_URL = "http://127.0.0.1:3210";
	process.env.VITE_ENVIRONMENT = "dev";
	process.env.VITE_POSTHOG_KEY = "test";
	process.env.VITE_POSTHOG_SURVEY_ID = "test";
	process.env.CONVEX_URL = "http://127.0.0.1:3210";
	process.env.CONVEX_SITE_URL = "http://127.0.0.1:3211";
	({ turn, steer, watch, stop } = await import("../../server/agent/chat.ts"));
});

beforeEach(() => {
	world.posted.length = 0;
	world.running = true;
	world.denied = false;
	world.watching.length = 0;
});

describe("a typed message", () => {
	test("is posted to its chat's thread as a user envelope whose forms may run", async () => {
		await send(turn, {
			input: {
				chatId: CHAT,
				message: "what is (+ 1 2)",
				annotations: { attachments: [] },
			},
		});
		expect(world.posted).toEqual([
			{
				chatId: CHAT,
				envelope: {
					kind: "user",
					id: expect.stringMatching(/^[0-9a-f-]{36}$/),
					text: "what is (+ 1 2)",
					forms: true,
					annotations: { attachments: [] },
				},
				options: undefined,
			},
		]);
	});

	test("is accepted without waiting for its turn", async () => {
		const response = await send(turn, {
			input: { chatId: CHAT, id: "m1", message: "hello" },
		});
		expect(response.status).toBe(202);
		expect(await response.json()).toEqual({ accepted: true, id: "m1" });
		expect(world.posted[0].envelope.id).toBe("m1");
	});

	test("is never posted to a chat the caller cannot read", async () => {
		world.denied = true;
		const response = await send(turn, {
			input: { chatId: CHAT, message: "hello" },
		});
		expect(response.ok).toBe(false);
		expect(world.posted).toEqual([]);
	});
});

describe("watching a chat", () => {
	const watchOf = (chatId: string) =>
		serve(watch)(new Request(`http://app.test/?chatId=${chatId}`));

	test("hands back the thread's stream for as long as the request lives", async () => {
		const response = await watchOf(CHAT);
		expect(await response.text()).toContain("event: status");
		expect(world.watching).toEqual([
			{ chatId: CHAT, signal: expect.any(AbortSignal) },
		]);
	});

	test("refuses a watch that names no chat", async () => {
		const response = await serve(watch)(new Request("http://app.test/"));
		expect(response.status).toBe(400);
		expect(world.watching).toEqual([]);
	});

	test("refuses a chat the caller cannot read", async () => {
		world.denied = true;
		expect((await watchOf(CHAT)).ok).toBe(false);
		expect(world.watching).toEqual([]);
	});
});

describe("stopping a chat", () => {
	test("aborts the turn its thread runs", async () => {
		const response = await send(stop, { chatId: CHAT });
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ stopped: true });
	});

	test("says so when no turn runs", async () => {
		world.running = false;
		const response = await send(stop, { chatId: CHAT });
		expect(response.status).toBe(409);
	});
});

describe("a steer", () => {
	test("is posted to the thread and never refused", async () => {
		const response = await send(steer, {
			chatId: CHAT,
			id: "s1",
			message: "also (+ 1 2)",
		});
		expect(response.status).toBe(202);
		expect(await response.json()).toEqual({ accepted: true });
		expect(world.posted[0].envelope).toEqual({
			kind: "user",
			id: "s1",
			text: "also (+ 1 2)",
			forms: true,
		});
	});
});
