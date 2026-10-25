import type { Thread } from "./thread.ts";

export class Threads {
	private readonly live = new Map<string, Thread>();

	constructor(private readonly open: (threadId: string) => Thread) {}

	get(threadId: string): Thread {
		const standing = this.live.get(threadId);
		if (standing !== undefined) return standing;
		const opened = this.open(threadId);
		this.live.set(threadId, opened);
		return opened;
	}
}
