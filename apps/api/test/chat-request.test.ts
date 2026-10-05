import { beforeAll, describe, expect, test } from "vitest";

const envelope = {
	input: { chatId: "j57dbngz9ch0dbd3vbc12sygs58ejt2q", message: "hello" },
	context: undefined,
	command: undefined,
};

let chatRequestSchema: typeof import("../src/chat.ts").chatRequestSchema;
let steerRequestSchema: typeof import("../src/chat.ts").steerRequestSchema;

beforeAll(async () => {
	process.env.APP_URL = "http://localhost:3000";
	process.env.CONVEX_URL = "http://127.0.0.1:3210";
	process.env.CONVEX_SITE_URL = "http://127.0.0.1:3211";
	({ chatRequestSchema, steerRequestSchema } = await import("../src/chat.ts"));
});

describe("the chat request contract", () => {
	test("accepts the envelope the streaming transport posts", () => {
		const parsed = chatRequestSchema.safeParse(envelope);
		expect(parsed.success).toBe(true);
		expect(parsed.success && parsed.data.input).toEqual(envelope.input);
	});

	test("accepts a turn opened by a system event, which names a token and no text", () => {
		const input = { chatId: envelope.input.chatId, event: { token: "t1" } };
		const parsed = chatRequestSchema.safeParse({ input });
		expect(parsed.success && parsed.data.input).toEqual(input);
	});

	test("refuses a system event without a token", () => {
		const chatId = envelope.input.chatId;
		expect(
			chatRequestSchema.safeParse({ input: { chatId, event: {} } }).success,
		).toBe(false);
		expect(
			chatRequestSchema.safeParse({ input: { chatId, event: { token: "" } } })
				.success,
		).toBe(false);
	});

	test("refuses a turn posted without the envelope", () => {
		expect(chatRequestSchema.safeParse(envelope.input).success).toBe(false);
	});
});

describe("the steer request contract", () => {
	const steer = { chatId: envelope.input.chatId, id: "s1", message: "use hex" };

	test("accepts a steer naming its chat and its own id", () => {
		expect(steerRequestSchema.safeParse(steer).success).toBe(true);
	});

	test("refuses a blank steer or one without an id", () => {
		expect(
			steerRequestSchema.safeParse({ ...steer, message: "  " }).success,
		).toBe(false);
		expect(steerRequestSchema.safeParse({ ...steer, id: "" }).success).toBe(
			false,
		);
	});
});
