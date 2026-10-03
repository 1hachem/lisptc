export interface Steer {
	id: string;
	content: string;
}

export interface SteerInbox {
	open(key: string): Promise<void>;
	close(key: string): Promise<void>;
	post(key: string, steer: Steer): Promise<boolean>;
	withdraw(key: string, id: string): Promise<boolean>;
	take(key: string): Promise<Steer[]>;
}

export class MemorySteerInbox implements SteerInbox {
	private readonly pending = new Map<string, Steer[]>();

	async open(key: string): Promise<void> {
		this.pending.set(key, []);
	}

	async close(key: string): Promise<void> {
		this.pending.delete(key);
	}

	async post(key: string, steer: Steer): Promise<boolean> {
		const queue = this.pending.get(key);
		if (queue === undefined) return false;
		queue.push(steer);
		return true;
	}

	async withdraw(key: string, id: string): Promise<boolean> {
		const queue = this.pending.get(key);
		const at = queue?.findIndex((s) => s.id === id) ?? -1;
		if (queue === undefined || at === -1) return false;
		queue.splice(at, 1);
		return true;
	}

	async take(key: string): Promise<Steer[]> {
		const queue = this.pending.get(key);
		if (queue === undefined || queue.length === 0) return [];
		this.pending.set(key, []);
		return queue;
	}
}
