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
import { kgEnv } from "@repo/env/kg";
import { filePrompt } from "@repo/shared/host-node";
import type { GraphStore, KgHost, StoredGraph } from "./ports.ts";

const SUFFIX = ".kg.ptc";

function graphDir(): string {
	return (
		kgEnv.LISPTC_KG_DIR ??
		join(
			kgEnv.XDG_CONFIG_HOME ?? join(homedir(), ".config"),
			"lisptc",
			"graphs",
		)
	);
}

export class FileGraphStore implements GraphStore {
	constructor(private readonly dir: string = graphDir()) {}

	private file(name: string): string {
		return join(this.dir, `${encodeURIComponent(name)}${SUFFIX}`);
	}

	all(): StoredGraph[] {
		if (!existsSync(this.dir)) return [];
		return readdirSync(this.dir)
			.filter((entry) => entry.endsWith(SUFFIX))
			.map((entry) => ({
				name: decodeURIComponent(entry.slice(0, -SUFFIX.length)),
				source: readFileSync(join(this.dir, entry), "utf8"),
			}));
	}

	put({ name, source }: StoredGraph): void {
		mkdirSync(this.dir, { recursive: true });
		writeFileSync(this.file(name), source, { mode: 0o600 });
	}

	remove(name: string): boolean {
		const file = this.file(name);
		if (!existsSync(file)) return false;
		rmSync(file);
		return true;
	}
}

const kgPrompt = filePrompt(new URL("./kg.ptc", import.meta.url));
const kgMemories = filePrompt(new URL("./kg.memories.ptc", import.meta.url));

export function kgHostFor(options: { store: GraphStore }): KgHost {
	return { store: options.store, prompt: kgPrompt, memories: kgMemories };
}

export const kgHost: KgHost = kgHostFor({ store: new FileGraphStore() });
