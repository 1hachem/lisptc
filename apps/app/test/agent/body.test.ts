import { describe, expect, test } from "vitest";
import { z } from "zod";
import { body } from "../../server/agent/body.ts";
import { post, serve } from "../helpers.ts";

const schema = z.object({ chatId: z.string().min(1), count: z.number() });

let reached = 0;

const echo = {
	middleware: [body(schema)],
	handler: ({ context }: { context: { body: z.infer<typeof schema> } }) => {
		reached++;
		return Response.json(context.body);
	},
};

describe("a request body checked at the edge", () => {
	test("reaches the handler parsed when it matches the schema", async () => {
		const response = await post(echo, {
			chatId: "c1",
			count: 2,
			extra: "dropped",
		});
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ chatId: "c1", count: 2 });
	});

	test("is refused with the schema's errors before the handler runs", async () => {
		const before = reached;
		const response = await post(echo, { chatId: "", count: "two" });
		expect(response.status).toBe(400);
		const { error } = (await response.json()) as {
			error: { properties?: Record<string, unknown> };
		};
		expect(Object.keys(error.properties ?? {}).sort()).toEqual([
			"chatId",
			"count",
		]);
		expect(reached).toBe(before);
	});

	test("is refused when it is not JSON at all", async () => {
		const response = await serve(echo)(
			new Request("http://app.test/", { method: "POST", body: "not json" }),
		);
		expect(response.status).toBe(400);
	});
});
