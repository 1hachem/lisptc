import { beforeAll, describe, expect, test } from "vitest";

const envelope = {
	input: { chatId: "j57dbngz9ch0dbd3vbc12sygs58ejt2q", message: "hello" },
	context: undefined,
	command: undefined,
};

let chatRequestSchema: typeof import("../src/chat.ts").chatRequestSchema;

beforeAll(async () => {
	process.env.APP_URL = "http://localhost:3000";
	process.env.CONVEX_URL = "http://127.0.0.1:3210";
	process.env.CONVEX_SITE_URL = "http://127.0.0.1:3211";
	({ chatRequestSchema } = await import("../src/chat.ts"));
});

describe("the chat request contract", () => {
	test("accepts the envelope the streaming transport posts", () => {
		const parsed = chatRequestSchema.safeParse(envelope);
		expect(parsed.success).toBe(true);
		expect(parsed.success && parsed.data.input).toEqual(envelope.input);
	});

	test("refuses a turn posted without the envelope", () => {
		expect(chatRequestSchema.safeParse(envelope.input).success).toBe(false);
	});
});
