import type { SessionHooks } from "@repo/interpreter/session";
import type { Awaitable, Clock, PromptSource } from "@repo/shared/host";

export type Verdict = "allow" | "deny" | "ask";

export interface Ruling {
	readonly verdict: Verdict;
	readonly reason?: string;
}

export type ServerAccess =
	| { readonly access: "open" }
	| { readonly access: "hidden" }
	| { readonly access: "denied"; readonly reason?: string };

export interface PermissionsStore {
	source(): string;
	save(source: string): Awaitable<void>;
}

export class MemoryPermissionsStore implements PermissionsStore {
	constructor(private text = "") {}

	source(): string {
		return this.text;
	}

	save(source: string): void {
		this.text = source;
	}
}

export interface ApprovalRequest {
	readonly id: string;
	readonly name: string;
	readonly args: string;
	readonly reason?: string;
	readonly at: number;
	readonly change?: true;
}

export type Scope = "once" | "session";

export interface Decision {
	readonly id: string;
	readonly approved: boolean;
	readonly scope: Scope;
	readonly by: string;
}

export interface Approvals {
	open(request: ApprovalRequest): void;
	pending(): ApprovalRequest[];
	resolve(decision: Decision): ApprovalRequest | undefined;
	granted(name: string): boolean;
	consume(name: string): void;
	onResolved(
		listener: (request: ApprovalRequest, decision: Decision) => void,
	): void;
}

export interface Approver {
	readonly kind: string;
	ask?(request: ApprovalRequest): void;
	session?(hooks: SessionHooks, approvals: Approvals): void;
}

export interface PermissionsHost {
	store: PermissionsStore;
	approvals: Approvals;
	approvers: readonly Approver[];
	clock: Clock;
	prompt: PromptSource;
	asks?: readonly string[];
}
