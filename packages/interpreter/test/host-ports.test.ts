import type { PromptSource } from "@repo/shared/host";
import { describe, expect, it } from "vitest";
import { compactionExtension } from "../src/extensions/compaction/compaction.ts";
import { compactionHost } from "../src/extensions/compaction/compaction-host.ts";
import {
	type MemoryStore,
	memoryExtension,
	VolatileStore,
} from "../src/extensions/memory/memory.ts";
import { memoryHost } from "../src/extensions/memory/memory-host.ts";
import { promisesExtension } from "../src/extensions/promises/promises.ts";
import { promisesHost } from "../src/extensions/promises/promises-host.ts";
import { proseExtension } from "../src/extensions/prose/prose.ts";
import { proseHost } from "../src/extensions/prose/prose-host.ts";
import { secretsExtension } from "../src/extensions/secrets/secrets.ts";
import { secretsHost } from "../src/extensions/secrets/secrets-host.ts";
import type { InterpExtension } from "../src/lisp.ts";

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

const defaults: [string, () => InterpExtension][] = [
	["compaction", () => compactionExtension()],
	["memory", () => memoryExtension()],
	["promises", () => promisesExtension()],
	["prose", () => proseExtension()],
	["secrets", () => secretsExtension()],
];

describe("every extension takes its prompt from the host", () => {
	it.each(swapped)("%s reads the supplied prompt", (_name, build) => {
		expect(build().prompt).toBe("a prompt the host supplied");
	});

	it.each(defaults)("%s falls back to its colocated .ptc", (_name, build) => {
		expect(build().prompt).toBeTruthy();
	});
});

describe("a supplied store is the one the extension uses", () => {
	it("keeps memory off the filesystem when handed a volatile store", () => {
		const store = new VolatileStore();
		expect(memoryExtension({ ...memoryHost, store }).bank.store).toBe(store);
	});

	it("keeps secrets in the store it was handed", () => {
		const store = {
			get: () => ({ value: "v", description: "" }),
			list: (): Array<[string, string]> => [["REPL_K", ""]],
			set: () => {},
		};
		expect(secretsExtension({ ...secretsHost, store }).store).toBe(store);
	});

	it("reads the clock it was handed rather than the wall clock", () => {
		const clock = { now: () => 1_700_000_000_000 };
		const bank = memoryExtension({ ...memoryHost, clock }).bank;
		expect(bank.clock.now()).toBe(1_700_000_000_000);
	});
});

describe("a host with no filesystem behind it still builds", () => {
	it("runs every port from values the caller owns", () => {
		const store: MemoryStore = new VolatileStore();
		const extension = memoryExtension({
			store,
			clock: { now: () => 0 },
			prompt: () => "",
		});
		expect(extension.bank.store).toBe(store);
		expect(extension.prompt).toBe("");
	});
});
