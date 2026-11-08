import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { memoryEnv } from "@repo/env/memory";
import { EvalException } from "@repo/interpreter/errors";
import { type Awaitable, systemClock } from "@repo/shared/host";
import { filePrompt } from "@repo/shared/host-node";
import { z } from "zod";
import { memorySearchEngine } from "./memory-search.ts";
import {
	type MemoryHost,
	type MemoryRecord,
	type MemoryStore,
	recognizeNothing,
} from "./ports.ts";

const memoryRecord: z.ZodType<MemoryRecord> = z.object({
	key: z.string(),
	body: z.string(),
	on: z.string().optional(),
	links: z.array(z.object({ key: z.string(), weight: z.number() })),
	score: z.number(),
	used: z.number(),
	lastUsed: z.number(),
});

export function memoryDirFor(scope?: string): string {
	const base =
		memoryEnv.LISPTC_MEMORY_DIR ??
		join(
			memoryEnv.XDG_CONFIG_HOME ?? join(homedir(), ".config"),
			"lisptc",
			"memory",
		);
	return scope === undefined ? base : join(base, sanitize(scope));
}

function sanitize(name: string): string {
	return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function keyToFileName(key: string): string {
	return `${sanitize(key)}.json`;
}

export class FileMemoryStore implements MemoryStore {
	constructor(private readonly dir?: string) {}

	private base(): string {
		return this.dir ?? memoryDirFor();
	}

	private file(key: string): string {
		return join(this.base(), keyToFileName(key));
	}

	all(): MemoryRecord[] {
		const out: MemoryRecord[] = [];
		try {
			const base = this.base();
			if (!existsSync(base)) return out;
			for (const entry of readdirSync(base, { withFileTypes: true })) {
				if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
				const found = this.readOne(join(base, entry.name));
				if (found !== undefined) out.push(found);
			}
		} catch {}
		return out;
	}

	get(key: string): MemoryRecord | undefined {
		return this.readOne(this.file(key));
	}

	put(memory: MemoryRecord): void {
		try {
			mkdirSync(this.base(), { recursive: true, mode: 0o700 });
			writeFileSync(
				this.file(memory.key),
				`${JSON.stringify(memory, null, "\t")}\n`,
				{ mode: 0o600 },
			);
		} catch (ex) {
			throw new EvalException(
				"could not write this memory to disk",
				ex instanceof Error ? ex.message : String(ex),
				false,
			);
		}
	}

	delete(key: string): boolean {
		try {
			const file = this.file(key);
			if (!existsSync(file)) return false;
			rmSync(file, { force: true });
			return true;
		} catch {
			return false;
		}
	}

	private readOne(path: string): MemoryRecord | undefined {
		try {
			return memoryRecord.parse(JSON.parse(readFileSync(path, "utf8")));
		} catch {
			return undefined;
		}
	}
}

function then<A, B>(
	value: Awaitable<A>,
	next: (value: A) => Awaitable<B>,
): Awaitable<B> {
	return value instanceof Promise ? value.then(next) : next(value);
}

function both<A, B, C>(
	left: Awaitable<A>,
	right: Awaitable<B>,
	join: (left: A, right: B) => C,
): Awaitable<C> {
	if (left instanceof Promise || right instanceof Promise)
		return Promise.all([left, right]).then(([a, b]) => join(a, b));
	return join(left, right);
}

export class LayeredStore implements MemoryStore {
	constructor(
		private readonly own: MemoryStore,
		private readonly shared: MemoryStore,
	) {}

	all(): Awaitable<MemoryRecord[]> {
		return both(this.shared.all(), this.own.all(), (shared, own) => {
			const byKey = new Map<string, MemoryRecord>();
			for (const memory of shared) byKey.set(memory.key, memory);
			for (const memory of own) byKey.set(memory.key, memory);
			return [...byKey.values()];
		});
	}

	get(key: string): Awaitable<MemoryRecord | undefined> {
		return then(this.own.get(key), (mine) => mine ?? this.shared.get(key));
	}

	put(memory: MemoryRecord): Awaitable<void> {
		return this.own.put(memory);
	}

	delete(key: string): Awaitable<boolean> {
		return both(
			this.own.delete(key),
			this.shared.delete(key),
			(mine, theirs) => theirs || mine,
		);
	}
}

export function scopedMemoryStore(scope?: string): MemoryStore {
	const shared = new FileMemoryStore(memoryDirFor());
	if (scope === undefined) return shared;
	return new LayeredStore(new FileMemoryStore(memoryDirFor(scope)), shared);
}

const memoryPrompt = filePrompt(new URL("./memory.ptc", import.meta.url));
const memoryMemories = filePrompt(
	new URL("./memory.memories.ptc", import.meta.url),
);

export function memoryHostFor(scope?: string): MemoryHost {
	return {
		store: scopedMemoryStore(scope),
		clock: systemClock,
		prompt: memoryPrompt,
		memories: memoryMemories,
		search: memorySearchEngine,
		recognize: recognizeNothing,
	};
}

export const memoryHost: MemoryHost = {
	get store(): MemoryStore {
		return scopedMemoryStore();
	},
	clock: systemClock,
	prompt: memoryPrompt,
	memories: memoryMemories,
	search: memorySearchEngine,
	recognize: recognizeNothing,
};
