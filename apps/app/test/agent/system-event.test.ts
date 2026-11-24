import type { Mail, PostOptions } from "@repo/ai";
import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { type Method, postJson as send } from "../helpers.ts";

const CHAT = "j57dbngz9ch0dbd3vbc12sygs58ejt2q";

const world = vi.hoisted(() => ({
	posted: [] as {
		chatId: string;
		mail: Mail;
		options?: PostOptions;
	}[],
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
	post: async (chatId: string, mail: Mail, options?: PostOptions) => {
		world.posted.push({ chatId, mail, options });
		return {
			opened: Promise.resolve(undefined),
			ended: Promise.resolve({ answer: "done." }),
		};
	},
	withdrawPost: async () => true,
	stopThread: async () => true,
	answer: async () => ({
		output: "",
		error: false,
		entries: [{ kind: "asks", value: { decided: true } }],
	}),
}));

let chat: Method;
let stop: Method;

beforeAll(async () => {
	process.env.VITE_CONVEX_URL = "http://127.0.0.1:3210";
	process.env.VITE_ENVIRONMENT = "dev";
	process.env.VITE_POSTHOG_KEY = "test";
	process.env.VITE_POSTHOG_SURVEY_ID = "test";
	process.env.CONVEX_URL = "http://127.0.0.1:3210";
	process.env.CONVEX_SITE_URL = "http://127.0.0.1:3211";
	({ turn: chat, stop } = await import("../../server/agent/chat.ts"));
});

beforeEach(() => {
	world.posted.length = 0;
});

describe("a ui action", () => {
	test("refuses a stop scope it does not know", async () => {
		const response = await send(stop, { chatId: CHAT, scope: "siblings" });
		expect(response.status).toBe(400);
	});

	test("cannot be sent by the browser as a turn", async () => {
		const response = await send(chat, {
			input: { chatId: CHAT, event: { token: "x" } },
		});
		expect(response.ok).toBe(false);
		expect(world.posted).toEqual([]);
	});
});
