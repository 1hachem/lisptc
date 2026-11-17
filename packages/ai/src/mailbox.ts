import type { Awaitable } from "@repo/shared/host";
import type { Received } from "@repo/shared/journal";

export type Mail =
	| {
			kind: "user";
			id: string;
			text: string;
			forms: boolean;
			received?: Received;
	  }
	| {
			kind: "event";
			id: string;
			source: string;
			text: string;
			replyTo?: string;
			job?: string;
			failed?: true;
			noted?: true;
	  };

export interface Mailbox {
	post(threadId: string, mail: Mail): Awaitable<void>;
	take(threadId: string, max?: number): Awaitable<Mail[]>;
	withdraw(threadId: string, id: string): Awaitable<boolean>;
}

export class MemoryMailbox implements Mailbox {
	private readonly waiting = new Map<string, Mail[]>();

	post(threadId: string, mail: Mail): void {
		const queue = this.waiting.get(threadId);
		if (queue === undefined) this.waiting.set(threadId, [mail]);
		else queue.push(mail);
	}

	take(threadId: string, max = Number.POSITIVE_INFINITY): Mail[] {
		const queue = this.waiting.get(threadId);
		if (queue === undefined) return [];
		const taken = queue.splice(0, max);
		if (queue.length === 0) this.waiting.delete(threadId);
		return taken;
	}

	withdraw(threadId: string, id: string): boolean {
		const queue = this.waiting.get(threadId);
		const at = queue?.findIndex((mail) => mail.id === id) ?? -1;
		if (queue === undefined || at === -1) return false;
		queue.splice(at, 1);
		if (queue.length === 0) this.waiting.delete(threadId);
		return true;
	}
}
