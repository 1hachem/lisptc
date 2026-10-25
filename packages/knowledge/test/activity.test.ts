import { type Activity, activityKey } from "@repo/interpreter/annotations";
import { bufferTransport } from "@repo/interpreter/channels-host";
import { Interp, runAsync } from "@repo/interpreter/lisp";
import { prelude } from "@repo/interpreter/prelude";
import { noAnnotations, openSession } from "@repo/interpreter/session";
import { describe, expect, it } from "vitest";
import { knowledgeExtension } from "../src/knowledge.ts";
import { knowledgeHostFor } from "../src/knowledge-host.ts";
import { MemoryKnowledgeStore } from "../src/memory-store.ts";

class FullStore extends MemoryKnowledgeStore {
	override write(): void {
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
): Promise<Activity | undefined> {
	const extension = knowledgeExtension(
		knowledgeHostFor({
			store,
			downloader: {
				download: async (url) => {
					throw new Error(`offline: ${url.href}`);
				},
			},
			maxDownloadBytes: 1024,
			clock: ticking(1000, 25),
		}),
	);
	const interp = new Interp({ extensions: [extension] });
	await runAsync(interp, prelude);
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
	return activityKey.schema.safeParse(into.output[activityKey.name]).data;
}

describe("a knowledge file read or write", () => {
	it("reports each one as done, by verb and file name", async () => {
		expect(
			await activityOf(
				new MemoryKnowledgeStore(),
				'(knowledge/write "notes.md" "hi") (knowledge/read "notes.md")',
			),
		).toEqual([
			{
				kind: "file",
				label: "knowledge · write",
				detail: "notes.md",
				state: "done",
				id: "file-1",
				startedAt: 1000,
				ms: 25,
			},
			{
				kind: "file",
				label: "knowledge · read",
				detail: "notes.md",
				state: "done",
				id: "file-2",
				startedAt: 1050,
				ms: 25,
			},
		]);
	});

	it("reports failed when the store refuses the write", async () => {
		const activity = await activityOf(
			new FullStore(),
			'(knowledge/write "notes.md" "hi")',
		);
		expect(activity?.map((a) => [a.id, a.state, a.startedAt, a.ms])).toEqual([
			["file-1", "failed", 1000, 25],
		]);
	});
});
