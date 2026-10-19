import type { Image } from "@repo/interpreter/image";
import {
	type Checkpoint,
	type ImageStore,
	type Layer,
	LayerCursor,
} from "@repo/repl/image-store";
import { internal } from "../convex/_generated/api.js";
import type { Id } from "../convex/_generated/dataModel.js";
import { chunked } from "../convex/lib/chunks.ts";
import type { ServerClient } from "./server-client.ts";

export class ConvexImageStore implements ImageStore {
	private readonly cursor = new LayerCursor();
	private head: Id<"replLayers"> | undefined;

	constructor(
		private readonly replId: Id<"repls">,
		private readonly server: ServerClient,
	) {}

	async save(image: Image, origin?: string): Promise<void> {
		const layer = this.cursor.over(image);
		try {
			this.head = await this.server.mutation(internal.repls.record, {
				replId: this.replId,
				over: layer.whole ? undefined : this.head,
				origin,
				whole: layer.whole,
				chunks: chunked(JSON.stringify(layer)),
			});
		} catch (ex) {
			this.cursor.lose();
			throw ex;
		}
	}

	async latest(): Promise<Checkpoint | undefined> {
		const stored = await this.server.query(internal.repls.latest, {
			replId: this.replId,
		});
		if (stored === null) return undefined;
		const layers: Layer[] = stored.layers.map((chunks) =>
			JSON.parse(chunks.join("")),
		);
		const image = this.cursor.restack(layers);
		this.head = stored.head;
		return { depth: stored.depth, image };
	}
}
