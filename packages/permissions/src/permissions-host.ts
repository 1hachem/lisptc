import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
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
	constructor(readonly path: string) {}

	source(): string {
		return existsSync(this.path) ? readFileSync(this.path, "utf8") : "";
	}

	save(source: string): void {
		parseRules(source);
		mkdirSync(dirname(this.path), { recursive: true });
		writeFileSync(this.path, source, { mode: 0o600 });
	}
}

export function permissionsFile(): string {
	return (
		replEnv.LISPTC_PERMISSIONS_FILE ??
		join(replEnv.INIT_CWD || process.cwd(), ".lisptc", "permissions.ptc")
	);
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
		store: options.store ?? new FilePermissionsStore(permissionsFile()),
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
