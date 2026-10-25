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
	answered: [] as unknown[][],
	annotated: [] as unknown[],
	cancelled: [] as string[],
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
	spawn: async () => "child",
	post: async (chatId: string, envelope: Envelope, options?: PostOptions) => {
		world.posted.push({ chatId, envelope, options });
		return {
			opened: Promise.resolve(undefined),
			ended: Promise.resolve({ answer: "done." }),
		};
	},
	ask: async (chatId: string, envelope: Envelope, options?: PostOptions) => {
		world.posted.push({ chatId, envelope, options });
		return "job-1";
	},
	wait: async () => ({ answer: "done." }),
	withdraw: async () => true,
	stop: async (chatId: string) => {
		world.cancelled.push(chatId);
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
let chatTurns: typeof import("../../server/agent/chat-turns.ts").chatTurns;

beforeAll(async () => {
	process.env.VITE_CONVEX_URL = "http://127.0.0.1:3210";
	process.env.VITE_ENVIRONMENT = "dev";
	process.env.VITE_POSTHOG_KEY = "test";
	process.env.VITE_POSTHOG_SURVEY_ID = "test";
	process.env.CONVEX_URL = "http://127.0.0.1:3210";
	process.env.CONVEX_SITE_URL = "http://127.0.0.1:3211";
	({ turn: chat, stop } = await import("../../server/agent/chat.ts"));
	({ uiAction } = await import("../../server/agent/ui-action.ts"));
	({ chatTurns } = await import("../../server/agent/chat-turns.ts"));
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

	test("annotates nothing when the action failed", async () => {
		world.failed = true;
		await decide("ask-1");
		expect(world.annotated).toEqual([]);
	});

	test("cancels the chat's whole tree when the user stops it", async () => {
		const response = await send(stop, { chatId: CHAT });
		expect(response.status).toBe(200);
		expect(world.cancelled).toEqual([CHAT]);
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
