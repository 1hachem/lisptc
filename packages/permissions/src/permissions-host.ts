import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { replEnv } from "@repo/env/repl";
import { systemClock } from "@repo/shared/host";
import { filePrompt } from "@repo/shared/host-node";
import { MemoryApprovals } from "./approvals.ts";
import {
	type Approver,
	MemoryPermissionsStore,
	type PermissionsHost,
	type PermissionsStore,
} from "./ports.ts";
import { parseRules } from "./rules.ts";
import { uiApprover } from "./ui-approver.ts";

export class FilePermissionsStore implements PermissionsStore {
	private read: { readonly at: number; readonly text: string } | undefined;

	constructor(readonly path: string) {}

	source(): string {
		const at = statSync(this.path, { throwIfNoEntry: false })?.mtimeMs;
		if (at === undefined) return "";
		if (this.read?.at !== at)
			this.read = { at, text: readFileSync(this.path, "utf8") };
		return this.read.text;
	}

	save(source: string): void {
		parseRules(source);
		mkdirSync(dirname(this.path), { recursive: true });
		writeFileSync(this.path, source, { mode: 0o600 });
		this.read = undefined;
	}
}

function defaultPermissionsStore(): PermissionsStore {
	const file = replEnv.LISPTC_PERMISSIONS_FILE;
	return file === undefined
		? new MemoryPermissionsStore()
		: new FilePermissionsStore(file);
}

const permissionsPrompt = filePrompt(
	new URL("./permissions.ptc", import.meta.url),
);

export interface PermissionsHostOptions {
	store?: PermissionsStore;
	approvers?: readonly Approver[];
	asks?: readonly string[];
}

export function permissionsHostFor(
	options: PermissionsHostOptions = {},
): PermissionsHost {
	return {
		store: options.store ?? defaultPermissionsStore(),
		approvals: new MemoryApprovals(),
		approvers: options.approvers ?? [uiApprover],
		clock: systemClock,
		prompt: permissionsPrompt,
		...(options.asks === undefined ? {} : { asks: options.asks }),
	};
}

export function textPermissionsHost(source: string): PermissionsHost {
	return permissionsHostFor({ store: new MemoryPermissionsStore(source) });
}
