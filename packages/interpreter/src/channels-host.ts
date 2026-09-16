import type {
	Audience,
	ChannelTransport,
	Envelope,
	Topic,
} from "./channels.ts";
import { output } from "./topics.ts";

export interface ChannelBuffer extends ChannelTransport {
	readonly envelopes: readonly Envelope[];
	payloads<T>(topic: Topic<T>): T[];
	text(to: Audience): string;
}

export function bufferTransport(): ChannelBuffer {
	const envelopes: Envelope[] = [];
	return {
		envelopes,
		send(envelope) {
			envelopes.push(envelope);
			return true;
		},
		payloads<T>(topic: Topic<T>): T[] {
			return envelopes
				.filter((e) => e.topic === topic.name)
				.map((e) => e.payload as T);
		},
		text(to) {
			return envelopes
				.filter((e) => e.topic === output.name && e.to.includes(to))
				.map((e) => e.payload as string)
				.join("");
		},
	};
}
