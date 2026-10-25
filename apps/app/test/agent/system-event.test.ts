import type { Envelope, PostOptions } from "@repo/ai";
import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { type Method, post as send } from "../helpers.ts";

const CHAT = "j57dbngz9ch0dbd3vbc12sygs58ejt2q";
const NOTE = 'I approved (fs/write "a"). Carry on.';

const world = vi.hoisted(() => ({
	posted: [] as {
		chatId: string;
		envelope: Envelope;
		options?: PostOptions;
	}[],
	failed: false,
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

vi.mock("../../server/agent/convex.ts", () => ({
	convexAs: () => ({ query: async () => ({}), mutation: async () => {} }),
}));

vi.mock("../../server/agent/threads.ts", () => ({
	host: { repls: {} },
	post: async (chatId: string, envelope: Envelope, options?: PostOptions) => {
		world.posted.push({ chatId, envelope, options });
		return {
			opened: Promise.resolve(undefined),
			ended: Promise.resolve({ answer: "done." }),
		};
	},
	withdraw: async () => true,
}));

vi.mock("@repo/ai", async (importOriginal) => ({
	...(await importOriginal<typeof import("@repo/ai")>()),
	runUiAction: async () => ({
		output: "",
		error: world.failed,
		message: NOTE,
		annotations: {},
	}),
}));

let chat: Method;
let uiAction: Method;
let chatTurns: typeof import("../../server/agent/chat-turns.ts").chatTurns;

beforeAll(async () => {
	process.env.VITE_CONVEX_URL = "http://127.0.0.1:3210";
	process.env.VITE_ENVIRONMENT = "dev";
	process.env.VITE_POSTHOG_KEY = "test";
	process.env.VITE_POSTHOG_SURVEY_ID = "test";
	process.env.CONVEX_URL = "http://127.0.0.1:3210";
	process.env.CONVEX_SITE_URL = "http://127.0.0.1:3211";
	({ turn: chat } = await import("../../server/agent/chat.ts"));
	({ uiAction } = await import("../../server/agent/ui-action.ts"));
	({ chatTurns } = await import("../../server/agent/chat-turns.ts"));
});

beforeEach(() => {
	world.posted.length = 0;
	world.failed = false;
});

const decide = () =>
	send(uiAction, {
		chatId: CHAT,
		action: "permissions/decide",
		values: { id: "r1" },
	});

describe("the follow-up to a ui action", () => {
	test("is posted by the server to the chat's thread as an event", async () => {
		const body = (await (await decide()).json()) as Record<string, unknown>;
		expect(body.message).toBe(NOTE);
		expect(body.event).toBeUndefined();
		expect(world.posted).toEqual([
			{
				chatId: CHAT,
				envelope: {
					kind: "event",
					id: expect.any(String),
					source: "permissions/decide",
					text: NOTE,
				},
				options: undefined,
			},
		]);
	});

	test("is not posted when the action failed", async () => {
		world.failed = true;
		await decide();
		expect(world.posted).toEqual([]);
	});

	test("cannot be sent by the browser as a turn", async () => {
		const response = await send(chat, {
			input: { chatId: CHAT, event: { token: "x" } },
		});
		expect(response.ok).toBe(false);
		expect(world.posted).toEqual([]);
	});
});

describe("a sub-agent's chat", () => {
	test("is woken by a notice posted as an event, never a user message", async () => {
		await chatTurns().wake({
			chatId: CHAT as never,
			notice: { source: "agent:r", text: "(+ 1 2)" },
		});
		expect(world.posted[0].envelope).toEqual({
			kind: "event",
			id: expect.any(String),
			source: "agent:r",
			text: "(+ 1 2)",
		});
	});

	test("runs none of the forms in a message sent to it", async () => {
		const outcome = await chatTurns().reply(CHAT as never, "(+ 1 2)", {
			maxSteps: 3,
			signal: new AbortController().signal,
		});
		expect(outcome).toEqual({ answer: "done." });
		expect(world.posted[0].envelope).toMatchObject({ forms: false });
		expect(world.posted[0].options).toMatchObject({ maxSteps: 3 });
	});
});
