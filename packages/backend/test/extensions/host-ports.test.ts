import { compactionExtension } from "@repo/compaction-extension";
import { compactionHost } from "@repo/compaction-extension/host";
import { Interp } from "@repo/interpreter/lisp";
import type { InterpExtension } from "@repo/interpreter/session";
import { memoryExtension } from "@repo/memory-extension";
import { memoryHost } from "@repo/memory-extension/host";
import { type MemoryStore, VolatileStore } from "@repo/memory-extension/ports";
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

const colocated: [string, () => InterpExtension][] = [
	["compaction", () => compactionExtension(compactionHost)],
	["memory", () => memoryExtension(memoryHost)],
	["promises", () => promisesExtension(promisesHost)],
	["prose", () => proseExtension(proseHost)],
	["secrets", () => secretsExtension(secretsHost)],
];

const prompted = (extension: InterpExtension) =>
	new Interp({ extensions: [extension] }).systemPrompt();

describe("every extension takes its prompt from the host", () => {
	it.each(swapped)("%s teaches the supplied prompt", (_name, build) => {
		expect(prompted(build())).toContain("a prompt the host supplied");
	});

	it.each(colocated)("%s teaches its colocated .ptc", (_name, build) => {
		expect(prompted(build()).length).toBeGreaterThan(
			new Interp().systemPrompt().length,
		);
	});
});

describe("a supplied store is the one the extension uses", () => {
	it("keeps memory in the volatile store it was handed", async () => {
		const store = new VolatileStore();
		const r = memoryRepl([memoryExtension({ ...memoryHost, store })]);
		await r.eval('(memory/remember "k" "kept here")');
		expect((await store.get("k"))?.body).toBe("kept here");
	});

	it("keeps secrets in the store it was handed", async () => {
		const store = {
			get: () => ({ value: "v", description: "from the host" }),
			list: (): Array<[string, string]> => [["REPL_K", "from the host"]],
			set: () => {},
		};
		const r = memoryRepl([
			secretsExtension({ ...secretsHost, store }),
			compactionExtension(compactionHost),
		]);
		expect(await r.eval("(secrets)")).toContain("from the host");
	});
});

describe("a host with no filesystem behind it still builds", () => {
	it("runs every port from values the caller owns", async () => {
		const store: MemoryStore = new VolatileStore();
		const r = memoryRepl([
			memoryExtension({
				store,
				clock: { now: () => 0 },
				prompt: () => "",
				search: memoryHost.search,
			}),
		]);
		await r.eval('(memory/remember "k" "no disk")');
		expect((await store.get("k"))?.body).toBe("no disk");
	});
});
