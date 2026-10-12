import type { ChatInput, EvalMessage } from "@repo/ai";
import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { type Method, post as send } from "../helpers.ts";

const CHAT = "j57dbngz9ch0dbd3vbc12sygs58ejt2q";

const world = vi.hoisted(() => ({
	appended: [] as Record<string, unknown>[],
	storedWhenStreamed: [] as Record<string, unknown>[][],
	steered: [] as string[],
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
	convexAs: () => ({
		mutation: async (
			_ref: unknown,
			args: { messages?: Record<string, unknown>[] },
		) => {
			if (args.messages) world.appended.push(...args.messages);
		},
		query: async () =>
			world.appended.map(({ id, ...m }, i) => ({
				...m,
				wireId: id,
				_id: `row${i}`,
			})),
	}),
}));

const holdsForms = (message: string) => message.includes("(");

vi.mock("@repo/ai", async (importOriginal) => {
	const real = await importOriginal<typeof import("@repo/ai")>();
	return {
		...real,
		runsForms: async (message: string) => holdsForms(message),
		evalUserMessage: async (
			message: string,
		): Promise<EvalMessage | undefined> =>
			holdsForms(message)
				? { type: "tool", content: "3", id: "result" }
				: undefined,
		MemorySteerInbox: class extends real.MemorySteerInbox {
			override async post(
				_key: string,
				message: { id: string; content: string },
			): Promise<boolean> {
				world.steered.push(message.content);
				return true;
			}
		},
		streamChatResponse: (_input: ChatInput) => {
			world.storedWhenStreamed.push([...world.appended]);
			return new Response("");
		},
	};
});

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
	world.appended.length = 0;
	world.storedWhenStreamed.length = 0;
	world.steered.length = 0;
});

describe("a message that holds forms", () => {
	test("has its result stored after it and before the agent starts", async () => {
		await send(turn, { input: { chatId: CHAT, message: "what is (+ 1 2)" } });
		expect(world.storedWhenStreamed).toHaveLength(1);
		expect(world.storedWhenStreamed[0].map((m) => m.type)).toEqual([
			"human",
			"tool",
		]);
	});

	test("is not steered into a running turn, so it waits to run as its own", async () => {
		const response = await send(steer, {
			chatId: CHAT,
			id: "s1",
			message: "also (+ 1 2)",
		});
		expect(response.status).toBe(409);
		expect(world.steered).toEqual([]);
	});
});

describe("a message without forms", () => {
	test("is steered into the running turn", async () => {
		const response = await send(steer, {
			chatId: CHAT,
			id: "s2",
			message: "use hex",
		});
		expect(response.status).toBe(202);
		expect(world.steered).toEqual(["use hex"]);
	});
});
