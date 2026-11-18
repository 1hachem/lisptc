import { bufferSink } from "@repo/interpreter/journal";
import { bootAsync, Interp, runAsync } from "@repo/interpreter/lisp";
import {
	type ActivityEntry,
	activityKind,
} from "@repo/journal-catalog/activity";
import { view } from "@repo/shared/journal";
import { describe, expect, it } from "vitest";
import { knowledgeExtension } from "../src/knowledge.ts";
import { knowledgeHostFor } from "../src/knowledge-host.ts";
import { MemoryKnowledgeStore } from "../src/memory-store.ts";
import { EXPIRY } from "./helpers.ts";

class FullStore extends MemoryKnowledgeStore {
	override write(): string {
		throw new Error("disk full");
	}
}

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
	store: MemoryKnowledgeStore,
	code: string,
): Promise<ActivityEntry[]> {
	const extension = knowledgeExtension(
		knowledgeHostFor({
			store,
			downloader: {
				download: async (url) => {
					throw new Error(`offline: ${url.href}`);
				},
			},
			maxDownloadBytes: 1024,
			...EXPIRY,
			clock: ticking(1000, 25),
		}),
	);
	const interp = new Interp({ extensions: [extension] });
	await bootAsync(interp);
	const buffer = bufferSink();
	const detach = interp.journal.pipe(buffer);
	try {
		await runAsync(interp, code).catch(() => undefined);
	} finally {
		detach();
	}
	return view(buffer.entries, activityKind);
}

describe("a knowledge file read or write", () => {
	it("reports failed when the store refuses the write", async () => {
		const activity = await activityOf(
			new FullStore(),
			'(knowledge/write "notes.md" "hi")',
		);
		expect(activity?.map((a) => [a.id, a.state, a.startedAt, a.ms])).toEqual([
			["file-1", "failed", 1000, 25],
		]);
		expect(activity?.[0]?.error).toEqual(expect.stringMatching(/\S/));
	});
});
