import type {
	Audience,
	ChannelTransport,
	Envelope,
	Topic,
} from "./channels.ts";
import { output } from "./topics.ts";

export interface ChannelBuffer extends ChannelTransport {
	readonly envelopes: readonly Envelope[];
	collect<T>(topic: Topic<T>): T[];
	collectText(to: Audience): string;
}

export function bufferTransport(): ChannelBuffer {
	const envelopes: Envelope[] = [];
	return {
		envelopes,
		send(envelope) {
			envelopes.push(envelope);
			return true;
		},
		collect<T>(topic: Topic<T>): T[] {
			return envelopes
				.filter((e) => e.topic === topic.name)
				.map((e) => e.payload as T);
		},
		collectText(to) {
			return envelopes
				.filter((e) => e.topic === output.name && e.to.includes(to))
				.map((e) => e.payload as string)
				.join("");
		},
	};
}
