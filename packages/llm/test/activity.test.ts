import { bufferTransport } from "@repo/interpreter/channels-host";
import { journal } from "@repo/interpreter/journal";
import { Interp, runAsync, runSync } from "@repo/interpreter/lisp";
import { prelude } from "@repo/interpreter/prelude";
import {
	type ActivityEntry,
	activityOf as activityIn,
	activityKind,
} from "@repo/journal-catalog/activity";
import { entriesOf } from "@repo/shared/journal";
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
): Promise<{ activity: ActivityEntry[]; states: string[] }> {
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
	const entries = buffer.collect(journal);
	return {
		activity: activityIn(entries),
		states: entriesOf(entries, activityKind).map((a) => a.state),
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
				icon: "model",
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
			activity?.map((a) => [
				a.id,
				a.label,
				a.state,
				a.startedAt,
				a.ms,
				a.error,
			]),
		).toEqual([
			["llm-1", "llm · default model", "done", 1000, 25, undefined],
			["llm-2", "llm · broken", "failed", 1050, 25, "down"],
		]);
	});
});
