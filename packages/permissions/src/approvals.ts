import type { ApprovalRequest, Approvals, Decision, Scope } from "./ports.ts";

type Resolved = (request: ApprovalRequest, decision: Decision) => void;

export class MemoryApprovals implements Approvals {
	private readonly open_ = new Map<string, ApprovalRequest>();
	private readonly grants = new Map<string, Scope>();
	private readonly listeners: Resolved[] = [];

	open(request: ApprovalRequest): void {
		for (const [id, held] of this.open_)
			if (held.name === request.name) this.open_.delete(id);
		this.open_.set(request.id, request);
	}

	pending(): ApprovalRequest[] {
		return [...this.open_.values()];
	}

	resolve(decision: Decision): ApprovalRequest | undefined {
		const request = this.open_.get(decision.id);
		if (request === undefined) return undefined;
		this.open_.delete(decision.id);
		if (decision.approved) this.grants.set(request.name, decision.scope);
		for (const listener of this.listeners) listener(request, decision);
		return request;
	}

	granted(name: string): boolean {
		return this.grants.has(name);
	}

	consume(name: string): void {
		if (this.grants.get(name) === "once") this.grants.delete(name);
	}

	onResolved(listener: Resolved): void {
		this.listeners.push(listener);
	}
}

export interface Resolution {
	readonly request: ApprovalRequest;
	readonly decision: Decision;
	readonly message: string;
}

export function resolveApproval(
	approvals: Approvals,
	decision: Decision,
): Resolution | undefined {
	const request = approvals.resolve(decision);
	if (request === undefined) return undefined;
	return { request, decision, message: followUp(request, decision) };
}

function followUp(request: ApprovalRequest, decision: Decision): string {
	if (request.change)
		return decision.approved
			? `I approved ${request.name}, and it is applied to the permissions config.`
			: `I denied ${request.name}, so the permissions config is unchanged.`;
	if (!decision.approved)
		return `I denied ${request.name}. Do not call it again; find another way or tell me what you need.`;
	const lasting =
		decision.scope === "once" ? "for one call" : "for the rest of this session";
	return `I approved ${request.name} ${lasting}. Carry on with what you were doing.`;
}
