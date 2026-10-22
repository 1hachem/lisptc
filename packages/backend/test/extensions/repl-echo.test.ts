import { lighten } from "@repo/shared/messages";
import { describe, expect, it } from "vitest";
import { agentRepl, modelFacing } from "./helpers.ts";

describe("a step that echoes text", () => {
	it("hands the text to the model and leaves the chat nothing of it", async () => {
		const out = await agentRepl(modelFacing()).evalOutput('(echo "rows: 42")');
		expect(out.model).toContain("rows: 42");

		const [shown] = lighten([
			{
				type: "tool",
				content: out.model,
				additional_kwargs: { display: out.user },
			},
		]);
		expect(JSON.stringify(shown)).not.toContain("rows: 42");
	});
});
