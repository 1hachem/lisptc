export type Severity = "critical" | "warning" | "note";

export interface Diagnostic {
	channel: string;
	severity?: Severity;
	text: string;
	value?: unknown;
	line?: number;
}

export const USER = "user";
export const MODEL = "model";
export const DEBUG = "debug";

export const ALL = "*";

export type Listener = (d: Diagnostic) => void;

export class Channels {
	private readonly listeners = new Map<string, Set<Listener>>();

	on(channel: string, listener: Listener): () => void {
		let set = this.listeners.get(channel);
		if (set === undefined) {
			set = new Set();
			this.listeners.set(channel, set);
		}
		set.add(listener);
		return () => {
			set.delete(listener);
		};
	}

	emit(d: Diagnostic): void {
		for (const channel of [d.channel, ALL])
			for (const listener of this.listeners.get(channel) ?? [])
				try {
					listener(d);
				} catch {}
	}
}
