import type { Annotations } from "@repo/interpreter/session";
import type { Awaitable } from "@repo/shared/host";

export type Envelope =
	| {
			kind: "user";
			id: string;
			text: string;
			forms: boolean;
			annotations?: Annotations;
	  }
	| {
			kind: "event";
			id: string;
			source: string;
			text: string;
			replyTo?: string;
			job?: string;
			failed?: true;
	  };

export interface Mailbox {
	post(threadId: string, envelope: Envelope): Awaitable<void>;
	take(threadId: string, max?: number): Awaitable<Envelope[]>;
	withdraw(threadId: string, id: string): Awaitable<boolean>;
}

export class MemoryMailbox implements Mailbox {
	private readonly waiting = new Map<string, Envelope[]>();

	post(threadId: string, envelope: Envelope): void {
		const queue = this.waiting.get(threadId);
		if (queue === undefined) this.waiting.set(threadId, [envelope]);
		else queue.push(envelope);
	}

	take(threadId: string, max = Number.POSITIVE_INFINITY): Envelope[] {
		const queue = this.waiting.get(threadId);
		if (queue === undefined) return [];
		const taken = queue.splice(0, max);
		if (queue.length === 0) this.waiting.delete(threadId);
		return taken;
	}

	withdraw(threadId: string, id: string): boolean {
		const queue = this.waiting.get(threadId);
		const at = queue?.findIndex((envelope) => envelope.id === id) ?? -1;
		if (queue === undefined || at === -1) return false;
		queue.splice(at, 1);
		if (queue.length === 0) this.waiting.delete(threadId);
		return true;
	}
}
