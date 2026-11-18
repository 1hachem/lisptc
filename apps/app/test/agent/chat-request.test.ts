import { beforeAll, describe, expect, test, vi } from "vitest";
import { type Method, postJson as send } from "../helpers.ts";

const CHAT = "j57dbngz9ch0dbd3vbc12sygs58ejt2q";

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
	post: async () => ({ ended: Promise.resolve({ answer: "done." }) }),
	watchThread: () => new Response(""),
	stopThread: () => true,
	withdrawPost: async () => true,
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

describe("a posted turn", () => {
	test("is refused when a message sends an envelope field the model would read", async () => {
		const response = await send(turn, {
			input: { chatId: CHAT, message: "hello", received: { noted: true } },
		});
		expect(response.status).toBe(400);
	});

	test("is refused when posted without the envelope", async () => {
		const response = await send(turn, { chatId: CHAT, message: "hello" });
		expect(response.status).toBe(400);
	});
});

describe("a posted steer", () => {
	const valid = { chatId: CHAT, id: "s1", message: "use hex" };

	test("is refused when blank or without an id", async () => {
		expect((await send(steer, { ...valid, message: "  " })).status).toBe(400);
		expect((await send(steer, { ...valid, id: "" })).status).toBe(400);
	});
});
