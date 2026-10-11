import type {
	ApprovalRequest,
	Approvals,
	Decision,
	Scope,
	Settled,
} from "./ports.ts";

type Resolved = (
	request: ApprovalRequest,
	decision: Decision,
) => string | undefined;

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

	resolve(decision: Decision): Settled | undefined {
		const request = this.open_.get(decision.id);
		if (request === undefined) return undefined;
		this.open_.delete(decision.id);
		if (decision.approved) this.grants.set(request.name, decision.scope);
		let refused: string | undefined;
		for (const listener of this.listeners)
			refused = listener(request, decision) ?? refused;
		return refused === undefined ? { request } : { request, refused };
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
	const settled = approvals.resolve(decision);
	if (settled === undefined) return undefined;
	return {
		request: settled.request,
		decision,
		message: followUp(settled, decision),
	};
}

function followUp({ request, refused }: Settled, decision: Decision): string {
	if (request.change && decision.approved && refused !== undefined)
		return `I approved ${request.name}, but ${refused}.`;
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
