import type { SystemEvent } from "./system-event.ts";

export interface EventOwner {
	subject: string;
	chatId?: string;
}

export interface SystemEventBox {
	issue(owner: EventOwner, event: SystemEvent): Promise<string>;
	redeem(
		token: string,
		redeemer: Required<EventOwner>,
	): Promise<SystemEvent | undefined>;
}

interface Pending {
	owner: EventOwner;
	event: SystemEvent;
	expires: number;
}

const EVENT_TOKEN_TTL_MS = 15 * 60 * 1000;

export class MemorySystemEventBox implements SystemEventBox {
	private readonly pending = new Map<string, Pending>();

	constructor(
		private readonly now: () => number = Date.now,
		private readonly ttlMs: number = EVENT_TOKEN_TTL_MS,
	) {}

	async issue(owner: EventOwner, event: SystemEvent): Promise<string> {
		this.prune();
		const token = crypto.randomUUID();
		this.pending.set(token, {
			owner,
			event,
			expires: this.now() + this.ttlMs,
		});
		return token;
	}

	async redeem(
		token: string,
		redeemer: Required<EventOwner>,
	): Promise<SystemEvent | undefined> {
		this.prune();
		const held = this.pending.get(token);
		if (held === undefined) return undefined;
		const { owner } = held;
		if (owner.subject !== redeemer.subject) return undefined;
		if (owner.chatId !== undefined && owner.chatId !== redeemer.chatId)
			return undefined;
		this.pending.delete(token);
		return held.event;
	}

	private prune(): void {
		const now = this.now();
		for (const [token, held] of this.pending)
			if (held.expires <= now) this.pending.delete(token);
	}
}
