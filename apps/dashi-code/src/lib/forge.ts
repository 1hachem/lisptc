import { dashiCodesEnv } from "@repo/env/dashi-codes";
import { ghForge } from "./forge-gh.ts";

export type PullState = "open" | "merged" | "closed";

export interface PullCommit {
	sha: string;
	at: string;
	headline: string;
}

export interface PullFile {
	path: string;
	added: number;
	deleted: number;
}

export interface Pull {
	number: number;
	title: string;
	author: string;
	url: string;
	state: PullState;
	draft: boolean;
	openedAt: string;
	closedAt: string | null;
	mergedAt: string | null;
	base: string;
	head: string;
	added: number;
	deleted: number;
	changed: number;
	commits: PullCommit[];
	files: PullFile[];
}

export interface Forge {
	describe(): string;
	pulls(limit: number): Promise<Pull[]>;
}

const adapters: Record<typeof dashiCodesEnv.DASHI_CODES_FORGE, () => Forge> = {
	gh: ghForge,
};

export function forge(): Forge {
	return (adapters[dashiCodesEnv.DASHI_CODES_FORGE] ?? ghForge)();
}

export function pullLimit(): number {
	return dashiCodesEnv.DASHI_CODES_FORGE_LIMIT;
}
