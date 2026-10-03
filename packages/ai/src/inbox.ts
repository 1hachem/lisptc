export interface Steer {
	id: string;
	content: string;
}

export class SteerInbox {
	private readonly pending = new Map<string, Steer[]>();

	open(threadId: string): void {
		this.pending.set(threadId, []);
	}

	close(threadId: string): void {
		this.pending.delete(threadId);
	}

	post(threadId: string, steer: Steer): boolean {
		const queue = this.pending.get(threadId);
		if (queue === undefined) return false;
		queue.push(steer);
		return true;
	}

	withdraw(threadId: string, id: string): boolean {
		const queue = this.pending.get(threadId);
		const at = queue?.findIndex((s) => s.id === id) ?? -1;
		if (queue === undefined || at === -1) return false;
		queue.splice(at, 1);
		return true;
	}

	take(threadId: string): Steer[] {
		const queue = this.pending.get(threadId);
		if (queue === undefined || queue.length === 0) return [];
		this.pending.set(threadId, []);
		return queue;
	}
}
