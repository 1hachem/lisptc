export interface Limits {
	readonly steps?: number;
	readonly tokens?: number;
	readonly deadline?: number;
}

export interface Usage {
	readonly steps?: number;
	readonly tokens?: number;
}

interface Account {
	readonly parent: string | undefined;
	readonly limits: Limits;
	steps: number;
	tokens: number;
}

function tighter(
	a: number | undefined,
	b: number | undefined,
): number | undefined {
	if (a === undefined) return b;
	if (b === undefined) return a;
	return Math.min(a, b);
}

function within(a: Limits, b: Limits): Limits {
	const steps = tighter(a.steps, b.steps);
	const tokens = tighter(a.tokens, b.tokens);
	const deadline = tighter(a.deadline, b.deadline);
	return {
		...(steps === undefined ? {} : { steps }),
		...(tokens === undefined ? {} : { tokens }),
		...(deadline === undefined ? {} : { deadline }),
	};
}

export function exhausted(
	left: Limits,
	now: number = Date.now(),
): string | undefined {
	if (left.steps !== undefined && left.steps <= 0) return "out of steps";
	if (left.tokens !== undefined && left.tokens <= 0) return "out of tokens";
	if (left.deadline !== undefined && left.deadline <= now)
		return "past its deadline";
	return undefined;
}

export class Budget {
	private readonly accounts = new Map<string, Account>();

	has(thread: string): boolean {
		return this.accounts.has(thread);
	}

	open(thread: string, parent: string | undefined, asked: Limits = {}): Limits {
		const granted = parent === undefined ? asked : this.slice(parent, asked);
		this.accounts.set(thread, { parent, limits: granted, steps: 0, tokens: 0 });
		return granted;
	}

	slice(parent: string, asked: Limits = {}): Limits {
		return within(asked, this.remaining(parent));
	}

	remaining(thread: string): Limits {
		let left: Limits = {};
		for (const account of this.chain(thread)) {
			const { limits } = account;
			left = within(left, {
				...(limits.steps === undefined
					? {}
					: { steps: limits.steps - account.steps }),
				...(limits.tokens === undefined
					? {}
					: { tokens: limits.tokens - account.tokens }),
				...(limits.deadline === undefined ? {} : { deadline: limits.deadline }),
			});
		}
		return left;
	}

	charge(thread: string, usage: Usage): void {
		for (const account of this.chain(thread)) {
			account.steps += usage.steps ?? 0;
			account.tokens += usage.tokens ?? 0;
		}
	}

	private *chain(thread: string): Generator<Account> {
		const seen = new Set<string>();
		for (
			let at: string | undefined = thread;
			at !== undefined && !seen.has(at);
		) {
			seen.add(at);
			const account = this.accounts.get(at);
			if (account === undefined) return;
			yield account;
			at = account.parent;
		}
	}
}
