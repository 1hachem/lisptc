import type { ApprovalRequest, Approvals, Decision, Scope } from "./ports.ts";

export class MemoryApprovals implements Approvals {
	private readonly open_ = new Map<string, ApprovalRequest>();
	private readonly grants = new Map<string, Scope>();

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
		return request;
	}

	granted(name: string): boolean {
		return this.grants.has(name);
	}

	consume(name: string): void {
		if (this.grants.get(name) === "once") this.grants.delete(name);
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
	if (!decision.approved)
		return `I denied ${request.name}. Do not call it again; find another way or tell me what you need.`;
	const lasting =
		decision.scope === "once" ? "for one call" : "for the rest of this session";
	return `I approved ${request.name} ${lasting}. Carry on with what you were doing.`;
}
