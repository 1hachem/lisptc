import { describe, expect, it } from "vitest";
import { agentStatus } from "../src/lib/agent-status.ts";

describe("what the agent is doing, beside its avatar", () => {
	const idle = { loading: false, writing: undefined, queued: 0, asking: false };

	it("thinks before anything streams and between steps", () => {
		expect(agentStatus({ ...idle, loading: true })).toBe("thinking");
		expect(agentStatus({ ...idle, loading: true, writing: undefined })).toBe(
			"thinking",
		);
	});

	it("writes while its last step is text", () => {
		expect(agentStatus({ ...idle, loading: true, writing: "hi" })).toBe(
			"writing",
		);
	});

	it("learns while writing a memory or knowledge call", () => {
		for (const code of [
			'(memory/recall "deploys")',
			"(memories)",
			'(knowledge/read "q3.pdf")',
			"(attachments/list)",
		])
			expect(agentStatus({ ...idle, loading: true, writing: code })).toBe(
				"learning",
			);
	});

	it("only writes when the forms are of neither kind", () => {
		expect(agentStatus({ ...idle, loading: true, writing: "(+ 1 2)" })).toBe(
			"writing",
		);
	});

	it("steers while a note from the user is queued", () => {
		expect(
			agentStatus({ ...idle, loading: true, queued: 1, writing: "hi" }),
		).toBe("steering");
	});
});
