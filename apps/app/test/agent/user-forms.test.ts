import type { Envelope, PostOptions } from "@repo/ai";
import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { type Method, post as send } from "../helpers.ts";

const CHAT = "j57dbngz9ch0dbd3vbc12sygs58ejt2q";

const world = vi.hoisted(() => ({
	posted: [] as {
		chatId: string;
		envelope: Envelope;
		options?: PostOptions;
	}[],
	opens: true,
}));

vi.mock("../../server/agent/session.ts", async () => {
	const { createMiddleware } = await import("@tanstack/react-start");
	const { edge } = await import("../../server/agent/edge.ts");
	const session = createMiddleware({ type: "request" }).server(({ next }) =>
		next({ context: { session: { token: "u1", subject: "u1" } } }),
	);
	return {
		authed: [...edge, session],
		currentSession: () => ({ token: "u1", subject: "u1" }),
	};
});

vi.mock("../../server/agent/repls.ts", () => ({ repls: {} }));

vi.mock("../../server/agent/convex.ts", () => ({
	convexAs: () => ({ query: async () => ({}), mutation: async () => {} }),
}));

vi.mock("../../server/agent/threads.ts", () => ({
	post: async (
		_poster: unknown,
		chatId: string,
		envelope: Envelope,
		options?: PostOptions,
	) => {
		world.posted.push({ chatId, envelope, options });
		return {
			opened: Promise.resolve(
				world.opens ? new Response("event: values\n\n") : undefined,
			),
			ended: Promise.resolve({ answer: "done." }),
		};
	},
	withdraw: async () => true,
}));

let turn: Method;
let steer: Method;

beforeAll(async () => {
	process.env.VITE_CONVEX_URL = "http://127.0.0.1:3210";
	process.env.VITE_ENVIRONMENT = "dev";
	process.env.VITE_POSTHOG_KEY = "test";
	process.env.VITE_POSTHOG_SURVEY_ID = "test";
	process.env.CONVEX_URL = "http://127.0.0.1:3210";
	process.env.CONVEX_SITE_URL = "http://127.0.0.1:3211";
	({ turn, steer } = await import("../../server/agent/chat.ts"));
});

beforeEach(() => {
	world.posted.length = 0;
	world.opens = true;
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
				options: expect.objectContaining({ watch: true }),
			},
		]);
	});

	test("streams back the turn its post opened", async () => {
		const response = await send(turn, {
			input: { chatId: CHAT, message: "hello" },
		});
		expect(await response.text()).toContain("event: values");
	});

	test("answers with no content when a running turn took it", async () => {
		world.opens = false;
		const response = await send(turn, {
			input: { chatId: CHAT, message: "hello" },
		});
		expect(response.status).toBe(204);
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
