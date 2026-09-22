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
import { EvalException, Reader, str } from "@repo/interpreter/lisp";
import { type Awaitable, systemClock } from "@repo/shared/host";
import { filePrompt } from "@repo/shared/host-node";
import {
	defineJudge,
	isJudgeName,
	judgeReports,
	judgeSpecFor,
} from "@repo/shared/judge";
import { judgeLearner } from "./learn-client.ts";
import {
	formToMemory,
	type Learner,
	type Learning,
	type Memory,
	type MemoryHost,
	type MemoryStore,
	memoryToForm,
	noLearner,
	type Watcher,
} from "./memory.ts";

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
	return `${sanitize(key)}.ptc`;
}

export class FileMemoryStore implements MemoryStore {
	constructor(private readonly dir?: string) {}

	private base(): string {
		return this.dir ?? memoryDirFor();
	}

	private file(key: string): string {
		return join(this.base(), keyToFileName(key));
	}

	all(): Memory[] {
		const out: Memory[] = [];
		try {
			const base = this.base();
			if (!existsSync(base)) return out;
			for (const entry of readdirSync(base, { withFileTypes: true })) {
				if (!entry.isFile() || !entry.name.endsWith(".ptc")) continue;
				const memory = this.readOne(join(base, entry.name));
				if (memory !== undefined) out.push(memory);
			}
		} catch {}
		return out;
	}

	get(key: string): Memory | undefined {
		return this.readOne(this.file(key));
	}

	put(memory: Memory): void {
		try {
			mkdirSync(this.base(), { recursive: true, mode: 0o700 });
			writeFileSync(this.file(memory.key), `${str(memoryToForm(memory))}\n`, {
				mode: 0o600,
			});
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

	private readOne(path: string): Memory | undefined {
		try {
			const reader = new Reader();
			reader.push(readFileSync(path, "utf8"));
			return formToMemory(reader.read());
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

	all(): Awaitable<Memory[]> {
		return both(this.shared.all(), this.own.all(), (shared, own) => {
			const byKey = new Map<string, Memory>();
			for (const memory of shared) byKey.set(memory.key, memory);
			for (const memory of own) byKey.set(memory.key, memory);
			return [...byKey.values()];
		});
	}

	get(key: string): Awaitable<Memory | undefined> {
		return then(this.own.get(key), (mine) => mine ?? this.shared.get(key));
	}

	put(memory: Memory): Awaitable<void> {
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

let configured: Learner | undefined;

async function configuredLearner(): Promise<Learner> {
	if (configured !== undefined) return configured;
	try {
		const { defaultJudge, judgeSpecs } = await import("@repo/env/providers");
		const ready =
			isJudgeName(defaultJudge) &&
			judgeReports(judgeSpecs, defaultJudge).some(
				(one) => one.name === defaultJudge && one.ready,
			);
		configured = ready
			? judgeLearner(defineJudge(judgeSpecFor(defaultJudge, judgeSpecs)))
			: noLearner;
	} catch {
		configured = noLearner;
	}
	return configured;
}

function money(cost: number | undefined): string {
	return cost === undefined ? "" : ` $${cost.toFixed(6)}`;
}

function pick(picked: { key: string; confidence: number } | undefined): string {
	return picked === undefined
		? "-"
		: `${picked.key}/${picked.confidence.toFixed(2)}`;
}

function line(event: Learning): string {
	const head = `learn ${event.at} ${event.ms}ms`;
	if (event.failed !== undefined) return `${head} FAILED ${event.failed}`;
	if (event.at === "vet") {
		const vetted = event.vetted;
		if (vetted === undefined) return `${head} no answer`;
		return `${head} durable=${vetted.durable.toFixed(2)} recomputable=${vetted.recomputable.toFixed(2)} covered=${pick(vetted.covered)}${money(vetted.cost)}${event.refusal === undefined ? "" : ` REFUSED ${event.refusal}`}`;
	}
	const judged = event.judged;
	if (judged === undefined) return `${head} no answer`;
	return `${head} worth=${judged.worthKeeping.toFixed(2)} kind=${judged.kind}/${judged.kindConfidence.toFixed(2)} covered=${pick(judged.covered)} stale=${pick(judged.stale)}${judged.calibrated ? "" : " uncalibrated"}${money(judged.cost)}`;
}

const memoryWatcher: Watcher = (event) => {
	if (event.failed === undefined && !memoryEnv.LISPTC_LEARN_LOG) return;
	console.error(line(event));
};

const memoryLearner: Learner = {
	async consider(observed, signal) {
		return await (await configuredLearner()).consider(observed, signal);
	},
	async vet(proposed, signal) {
		return await (await configuredLearner()).vet(proposed, signal);
	},
};

export function memoryHostFor(scope?: string): MemoryHost {
	return {
		store: scopedMemoryStore(scope),
		clock: systemClock,
		learn: memoryLearner,
		watch: memoryWatcher,
		prompt: memoryPrompt,
	};
}

export const memoryHost: MemoryHost = {
	get store(): MemoryStore {
		return scopedMemoryStore();
	},
	clock: systemClock,
	learn: memoryLearner,
	watch: memoryWatcher,
	prompt: memoryPrompt,
};
