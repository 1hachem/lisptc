import type { ChatInput, Evaluated } from "@repo/ai";
import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { type Method, post as send, serve } from "../helpers.ts";

const CHAT = "j57dbngz9ch0dbd3vbc12sygs58ejt2q";

const world = vi.hoisted(() => ({
	appended: [] as Record<string, unknown>[],
	storedWhenStreamed: [] as Record<string, unknown>[][],
	sent: [] as ChatInput[],
	quiet: [] as boolean[],
	runsForms: [] as (boolean | undefined)[],
	evaluated: [] as string[],
	lisp: true,
	steered: [] as string[],
	evaluating: () => {},
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

vi.mock("../../server/agent/convex.ts", async () => {
	const { getFunctionName } = await import("convex/server");
	return {
		convexAs: () => ({
			mutation: async (
				_ref: unknown,
				args: { messages?: Record<string, unknown>[] },
			) => {
				if (args.messages) world.appended.push(...args.messages);
			},
			query: async (ref: Parameters<typeof getFunctionName>[0]) =>
				getFunctionName(ref) === "preferences:get"
					? { input: { lisp: world.lisp } }
					: world.appended.map(({ id, ...m }, i) => ({
							...m,
							wireId: id,
							_id: `row${i}`,
						})),
		}),
	};
});

const holdsForms = (message: string) => message.includes("(");

vi.mock("@repo/ai", async (importOriginal) => {
	const real = await importOriginal<typeof import("@repo/ai")>();
	return {
		...real,
		evalUserMessage: async (
			message: string,
		): Promise<Evaluated | undefined> => {
			world.evaluating();
			world.evaluated.push(message);
			if (message.startsWith("slow"))
				await new Promise((resolve) => setTimeout(resolve, 20));
			return holdsForms(message)
				? {
						message: { type: "tool", content: "3", id: "result" },
						quiet: message.includes("quietly"),
					}
				: undefined;
		},
		MemorySteerInbox: class extends real.MemorySteerInbox {
			override async post(
				_key: string,
				message: { kind: string; id: string; content: string },
			): Promise<boolean> {
				world.steered.push(message.content);
				return true;
			}
		},
		streamChatResponse: (
			input: ChatInput,
			options: { quiet?: boolean; runsForms?: boolean },
		) => {
			world.sent.push(input);
			world.quiet.push(options.quiet === true);
			world.runsForms.push(options.runsForms);
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
	world.sent.length = 0;
	world.quiet.length = 0;
	world.runsForms.length = 0;
	world.evaluated.length = 0;
	world.lisp = true;
	world.steered.length = 0;
	world.evaluating = () => {};
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

	test("starts the agent unless a form asked to stay quiet", async () => {
		await send(turn, { input: { chatId: CHAT, message: "what is (+ 1 2)" } });
		await send(turn, {
			input: { chatId: CHAT, message: "(quietly (+ 1 2))" },
		});
		expect(world.quiet).toEqual([false, true]);
		expect(world.appended.map((m) => m.type)).toEqual([
			"human",
			"tool",
			"human",
			"tool",
		]);
	});

	test("reaches the stream as the message then its result row, untouched", async () => {
		await send(turn, { input: { chatId: CHAT, message: "what is (+ 1 2)" } });
		expect(world.sent[0].messages).toEqual([
			expect.objectContaining({ type: "human", content: "what is (+ 1 2)" }),
			expect.objectContaining({ type: "tool", content: "3" }),
		]);
	});

	test("keeps a second turn in the same chat out until its result is stored", async () => {
		await Promise.all([
			send(turn, { input: { chatId: CHAT, message: "slow (+ 1 2)" } }),
			send(turn, { input: { chatId: CHAT, message: "next (+ 1 2)" } }),
		]);
		expect(world.appended.map((m) => `${m.type}:${m.content}`)).toEqual([
			"human:slow (+ 1 2)",
			"tool:3",
			"human:next (+ 1 2)",
			"tool:3",
		]);
	});

	test("is steered into the running turn like any other message", async () => {
		const response = await send(steer, {
			chatId: CHAT,
			id: "s1",
			message: "also (+ 1 2)",
		});
		expect(response.status).toBe(202);
		expect(world.steered).toEqual(["also (+ 1 2)"]);
	});

	test("keeps its result when the turn is aborted after the forms ran", async () => {
		const abort = new AbortController();
		world.evaluating = () => abort.abort();
		const response = serve(turn)(
			new Request("http://app.test/", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					input: { chatId: CHAT, message: "what is (+ 1 2)" },
				}),
				signal: abort.signal,
			}),
		);
		expect((await response).status).toBe(204);
		expect(world.appended.map((m) => m.type)).toEqual(["human", "tool"]);
		expect(world.sent).toHaveLength(0);
	});
});

describe("a message without forms", () => {
	test("reaches the agent as its plain text", async () => {
		await send(turn, { input: { chatId: CHAT, message: "use hex" } });
		expect(world.sent[0].messages).toEqual([
			expect.objectContaining({ type: "human", content: "use hex" }),
		]);
	});

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

describe("a message sent with lisp input turned off", () => {
	test("reaches the agent as its plain text, its forms never run", async () => {
		world.lisp = false;
		await send(turn, { input: { chatId: CHAT, message: "what is (+ 1 2)" } });
		expect(world.evaluated).toEqual([]);
		expect(world.appended.map((m) => m.type)).toEqual(["human"]);
		expect(world.sent[0].messages).toEqual([
			expect.objectContaining({ type: "human", content: "what is (+ 1 2)" }),
		]);
	});

	test("tells the turn not to run the forms of a steered message either", async () => {
		world.lisp = false;
		await send(turn, { input: { chatId: CHAT, message: "use hex" } });
		world.lisp = true;
		await send(turn, { input: { chatId: CHAT, message: "use hex" } });
		expect(world.runsForms).toEqual([false, true]);
	});
});
