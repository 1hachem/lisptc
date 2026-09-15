export type Audience = "user" | "model";

export const NOTE_TOPIC = "note";

export interface Envelope<T = unknown> {
	topic: string;
	to: readonly Audience[];
	step?: number;
	payload: T;
}

export type Listener = (e: Envelope) => void;

export interface Topic<T> {
	readonly name: string;
	emit(channels: Channels, to: readonly Audience[], payload: T): void;
	on(
		channels: Channels,
		listener: (payload: T, e: Envelope<T>) => void,
	): () => void;
}

export function topic<T>(name: string): Topic<T> {
	return {
		name,
		emit(channels, to, payload) {
			channels.emit({ topic: name, to, payload });
		},
		on(channels, listener) {
			return channels.on(name, (e) =>
				listener(e.payload as T, e as Envelope<T>),
			);
		},
	};
}

export interface ChannelTransport {
	send(envelope: Envelope): boolean;
	close?(): void;
}

export class Channels {
	private readonly listeners = new Map<string, Set<Listener>>();
	private readonly anyone = new Set<Listener>();
	private readonly transports = new Set<ChannelTransport>();
	step = 0;

	on(topic: string, listener: Listener): () => void {
		let set = this.listeners.get(topic);
		if (set === undefined) {
			set = new Set();
			this.listeners.set(topic, set);
		}
		set.add(listener);
		return () => {
			set.delete(listener);
		};
	}

	onAny(listener: Listener): () => void {
		this.anyone.add(listener);
		return () => {
			this.anyone.delete(listener);
		};
	}

	pipe(transport: ChannelTransport): () => void {
		this.transports.add(transport);
		return () => {
			if (this.transports.delete(transport)) transport.close?.();
		};
	}

	emit(e: Envelope): void {
		const envelope = e.step === undefined ? { ...e, step: this.step } : e;
		const broken: string[] = [];
		for (const listener of [
			...(this.listeners.get(envelope.topic) ?? []),
			...this.anyone,
		])
			try {
				listener(envelope);
			} catch (ex) {
				broken.push(ex instanceof Error ? ex.message : String(ex));
			}
		for (const transport of [...this.transports])
			try {
				if (!transport.send(envelope)) this.transports.delete(transport);
			} catch {
				this.transports.delete(transport);
			}
		if (envelope.topic === NOTE_TOPIC) return;
		for (const message of broken)
			this.emit({
				topic: NOTE_TOPIC,
				to: ["model"],
				payload: {
					kind: "failed",
					text: `a listener on ${envelope.topic} threw: ${message}`,
				},
			});
	}
}
