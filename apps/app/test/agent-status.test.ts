import { describe, expect, it } from "vitest";
import { agentStatus, pickStatusLine } from "../src/lib/agent-status.ts";

describe("what the agent is doing, beside its avatar", () => {
	const idle = { loading: false, writing: undefined, queued: 0, asking: false };

	it("says nothing when it is idle", () => {
		expect(agentStatus(idle)).toBeUndefined();
	});

	it("waits on the user while a question is open", () => {
		expect(agentStatus({ ...idle, asking: true })).toBe("waiting");
	});

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

	it("prepares while writing a ui call, even beside a memory call", () => {
		expect(
			agentStatus({
				...idle,
				loading: true,
				writing: '(memory/recall "x") (ui/card (ui/text "hi"))',
			}),
		).toBe("preparing");
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

	it("draws a different line for each roll, and every state has several", () => {
		for (const status of [
			"thinking",
			"learning",
			"preparing",
			"writing",
			"steering",
			"waiting",
		] as const) {
			const lines = new Set(
				[0, 0.2, 0.4, 0.6, 0.8, 0.99].map((roll) =>
					pickStatusLine(status, roll),
				),
			);
			expect(lines.size).toBeGreaterThan(2);
		}
	});
});
