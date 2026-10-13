import type { Checkpoint, ImageStore } from "@repo/repl/image-store";
import type { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";
import type { Id } from "../convex/_generated/dataModel.js";
import { REPL_IMAGE_CHUNK_CHARS } from "../convex/limits.ts";

export type ImageClient = Pick<ConvexHttpClient, "query" | "mutation">;

interface StoredCheckpoint {
	call: number;
	format: number;
	chunks: string[];
}

export function chunked(json: string): string[] {
	const chunks: string[] = [];
	for (let at = 0; at < json.length; at += REPL_IMAGE_CHUNK_CHARS)
		chunks.push(json.slice(at, at + REPL_IMAGE_CHUNK_CHARS));
	return chunks;
}

function decode(stored: StoredCheckpoint | null): Checkpoint | undefined {
	if (stored === null) return undefined;
	return { call: stored.call, image: JSON.parse(stored.chunks.join("")) };
}

export class ConvexImageStore implements ImageStore {
	constructor(
		private readonly chatId: Id<"chats">,
		private readonly connect: () => ImageClient,
	) {}

	async save({ call, image }: Checkpoint): Promise<void> {
		await this.connect().mutation(api.replImages.record, {
			chatId: this.chatId,
			call,
			format: image.format,
			chunks: chunked(JSON.stringify(image)),
		});
	}

	async latest(): Promise<Checkpoint | undefined> {
		return decode(
			await this.connect().query(api.replImages.latest, {
				chatId: this.chatId,
			}),
		);
	}

	async at(call: number): Promise<Checkpoint | undefined> {
		return decode(
			await this.connect().query(api.replImages.at, {
				chatId: this.chatId,
				call,
			}),
		);
	}

	async dropAfter(call: number): Promise<void> {
		await this.connect().mutation(api.replImages.dropAfter, {
			chatId: this.chatId,
			call,
		});
	}
}
