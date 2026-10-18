import type { Image } from "@repo/interpreter/image";

export interface Checkpoint {
	readonly call: number;
	readonly image: Image;
}

export interface ImageStore {
	save(checkpoint: Checkpoint): Promise<void>;
	latest(): Promise<Checkpoint | undefined>;
}

export class MemoryImageStore implements ImageStore {
	private readonly checkpoints = new Map<number, string>();

	async save({ call, image }: Checkpoint): Promise<void> {
		this.checkpoints.set(call, JSON.stringify(image));
	}

	async latest(): Promise<Checkpoint | undefined> {
		const calls = [...this.checkpoints.keys()];
		if (calls.length === 0) return undefined;
		const call = Math.max(...calls);
		return { call, image: JSON.parse(this.checkpoints.get(call) ?? "") };
	}
}
