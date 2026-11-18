import { bufferSink } from "@repo/interpreter/journal";
import { boot, Interp, runAsync } from "@repo/interpreter/lisp";
import {
	type ActivityEntry,
	activityKind,
} from "@repo/journal-catalog/activity";
import { every, view } from "@repo/shared/journal";
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
	boot(interp);
	const buffer = bufferSink();
	const detach = interp.journal.pipe(buffer);
	try {
		await runAsync(interp, code).catch(() => undefined);
	} finally {
		detach();
	}
	const entries = buffer.entries;
	return {
		activity: view(entries, activityKind),
		states: view(entries, { ...activityKind, fold: every }).map((a) => a.state),
	};
}

describe("a model call from lisp", () => {
	it("shows each call started, then done or failed with the reason and how long it took", async () => {
		const { activity, states } = await activityOf(async (req) => {
			if (req.model === "broken") throw new Error("down");
			return { text: "ok" };
		}, '(write "a") (write "b" :model "broken")');
		expect(states).toEqual(["started", "done", "started", "failed"]);
		expect(activity.map((a) => [a.label, a.state, a.ms, a.error])).toEqual([
			["write", "done", 25, undefined],
			["write", "failed", 25, "down"],
		]);
	});
});
