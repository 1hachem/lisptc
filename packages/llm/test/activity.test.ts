import { type Activity, activityKey } from "@repo/interpreter/annotations";
import { bufferTransport } from "@repo/interpreter/channels-host";
import { Interp, runAsync, runSync } from "@repo/interpreter/lisp";
import { prelude } from "@repo/interpreter/prelude";
import { noAnnotations, openSession } from "@repo/interpreter/session";
import { describe, expect, it } from "vitest";
import { type Generate, llmExtension } from "../src/llm.ts";
import { llmHost } from "../src/llm-host.ts";

function ticking(from: number, step: number): { now(): number } {
	let at = from - step;
	return {
		now: () => {
			at += step;
			return at;
		},
	};
}

async function activityOf(
	generate: Generate,
	code: string,
): Promise<{ activity: Activity | undefined; states: string[] }> {
	const extension = llmExtension({
		...llmHost,
		generate,
		clock: ticking(1000, 25),
	});
	const interp = new Interp({ extensions: [extension] });
	runSync(interp, prelude);
	const buffer = bufferTransport();
	const detach = interp.channels.pipe(buffer);
	try {
		await runAsync(interp, code).catch(() => undefined);
	} finally {
		detach();
	}
	const into = openSession([extension]).annotate.run(
		(_b, into) => into,
		buffer,
		noAnnotations(),
	);
	return {
		activity: activityKey.schema.safeParse(into.output[activityKey.name]).data,
		states: buffer.envelopes
			.filter((e) => e.topic === "llm-activity" && e.to.includes("user"))
			.map((e) => (e.payload as { state: string }).state),
	};
}

describe("a model call from lisp", () => {
	it("reports started, then done under the model that answered", async () => {
		const { activity, states } = await activityOf(
			async () => ({ text: "hi", provider: "digitalocean", model: "gemma" }),
			'(llm/complete "greet me")',
		);
		expect(states).toEqual(["started", "done"]);
		expect(activity).toEqual([
			{
				kind: "llm",
				label: "llm · gemma",
				detail: "llm/complete",
				state: "done",
				id: "llm-1",
				startedAt: 1000,
				ms: 25,
			},
		]);
	});

	it("reports failed when the model call fails, and numbers each call", async () => {
		const { activity } = await activityOf(async (req) => {
			if (req.model === "broken") throw new Error("down");
			return { text: "ok" };
		}, '(llm/complete "a") (llm/complete "b" :model "broken")');
		expect(
			activity?.map((a) => [a.id, a.label, a.state, a.startedAt, a.ms]),
		).toEqual([
			["llm-1", "llm · default model", "done", 1000, 25],
			["llm-2", "llm · broken", "failed", 1050, 25],
		]);
	});
});
