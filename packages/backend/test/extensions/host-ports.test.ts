import { compactionExtension } from "@repo/compaction-extension";
import { compactionHost } from "@repo/compaction-extension/host";
import { Interp } from "@repo/interpreter/lisp";
import type { InterpExtension } from "@repo/interpreter/session";
import { memoryExtension } from "@repo/memory-extension";
import { memoryHost } from "@repo/memory-extension/host";
import { VolatileStore } from "@repo/memory-extension/ports";
import { promisesExtension } from "@repo/promises-extension";
import { promisesHost } from "@repo/promises-extension/host";
import { proseExtension } from "@repo/prose-extension";
import { proseHost } from "@repo/prose-extension/host";
import { secretsExtension } from "@repo/secrets-extension";
import { secretsHost } from "@repo/secrets-extension/host";
import type { PromptSource } from "@repo/shared/host";
import { describe, expect, it } from "vitest";
import { memoryRepl } from "./helpers.ts";

const said: PromptSource = () => "a prompt the host supplied";

const swapped: [string, () => InterpExtension][] = [
	[
		"compaction",
		() => compactionExtension({ ...compactionHost, prompt: said }),
	],
	["memory", () => memoryExtension({ ...memoryHost, prompt: said })],
	["promises", () => promisesExtension({ ...promisesHost, prompt: said })],
	["prose", () => proseExtension({ ...proseHost, prompt: said })],
	["secrets", () => secretsExtension({ ...secretsHost, prompt: said })],
];

const prompted = (extension: InterpExtension) =>
	new Interp({ extensions: [extension] }).systemPrompt();

describe("every extension takes its prompt from the host", () => {
	it.each(swapped)("%s teaches the supplied prompt", (_name, build) => {
		expect(prompted(build())).toContain("a prompt the host supplied");
	});
});

describe("a supplied store is the one the extension uses", () => {
	it("hands what one repl remembered to another repl over the same store", async () => {
		const store = new VolatileStore();
		await memoryRepl([memoryExtension({ ...memoryHost, store })]).eval(
			'(memory/remember "k" "kept here" :when "the test asks for it")',
		);
		const other = memoryRepl([memoryExtension({ ...memoryHost, store })]);
		expect(await other.eval('(memory/recall "kept")')).toContain("kept here");
	});
});

describe("a host with no filesystem behind it still builds", () => {
	it("remembers and recalls on ports built from values the caller owns", async () => {
		const r = memoryRepl([
			memoryExtension({
				store: new VolatileStore(),
				clock: { now: () => 0 },
				prompt: () => "",
				memories: memoryHost.memories,
				search: memoryHost.search,
				recognize: () => new Map(),
			}),
		]);
		await r.eval(
			'(memory/remember "k" "no disk" :when "the test asks for it")',
		);
		expect(await r.eval('(memory/recall "disk")')).toContain("no disk");
	});
});
