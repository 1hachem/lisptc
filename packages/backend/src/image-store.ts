import type { Checkpoint, ImageStore } from "@repo/repl/image-store";
import { internal } from "../convex/_generated/api.js";
import type { Id } from "../convex/_generated/dataModel.js";
import { REPL_IMAGE_CHUNK_CHARS } from "../convex/limits.ts";
import type { ServerClient } from "./server-client.ts";

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
		private readonly replId: Id<"repls">,
		private readonly server: ServerClient,
	) {}

	async save({ call, image }: Checkpoint): Promise<void> {
		await this.server.mutation(internal.repls.record, {
			replId: this.replId,
			call,
			format: image.format,
			chunks: chunked(JSON.stringify(image)),
		});
	}

	async latest(): Promise<Checkpoint | undefined> {
		return decode(
			await this.server.query(internal.repls.latest, {
				replId: this.replId,
			}),
		);
	}
}
