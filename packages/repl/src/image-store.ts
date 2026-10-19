import type { Image } from "@repo/interpreter/image";
import { type Layer, layerOver, stack } from "./image-layer.ts";

export type { Layer };

export interface Checkpoint {
	readonly depth: number;
	readonly image: Image;
}

export interface ImageStore {
	save(image: Image, origin?: string): Promise<void>;
	latest(): Promise<Checkpoint | undefined>;
}

export const MAX_DELTA_RUN = 32;

export class LayerCursor {
	private below: Image | undefined;
	private run = 0;

	over(image: Image): Layer {
		const layer = layerOver(
			this.run >= MAX_DELTA_RUN ? undefined : this.below,
			image,
		);
		this.below = image;
		this.run = layer.whole ? 1 : this.run + 1;
		return layer;
	}

	restack(layers: readonly Layer[]): Image {
		const image = stack(layers);
		this.below = image;
		this.run = layers.length;
		return image;
	}

	lose(): void {
		this.below = undefined;
	}
}

interface Stored {
	readonly origin: string | undefined;
	readonly layer: string;
}

export class MemoryImageStore implements ImageStore {
	private readonly layers: Stored[] = [];
	private readonly cursor = new LayerCursor();

	async save(image: Image, origin?: string): Promise<void> {
		this.layers.push({
			origin,
			layer: JSON.stringify(this.cursor.over(image)),
		});
	}

	async latest(): Promise<Checkpoint | undefined> {
		const run: Layer[] = [];
		for (let at = this.layers.length - 1; at >= 0; at--) {
			const layer: Layer = JSON.parse(this.layers[at].layer);
			run.unshift(layer);
			if (layer.whole) break;
		}
		if (run.length === 0) return undefined;
		return { depth: this.layers.length, image: this.cursor.restack(run) };
	}

	origins(): (string | undefined)[] {
		return this.layers.map((stored) => stored.origin);
	}
}
