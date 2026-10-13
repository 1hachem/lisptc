import type { Image } from "@repo/interpreter/image";

export interface Checkpoint {
	readonly call: number;
	readonly image: Image;
}

export interface ImageStore {
	save(checkpoint: Checkpoint): Promise<void>;
	latest(): Promise<Checkpoint | undefined>;
	at(call: number): Promise<Checkpoint | undefined>;
	dropAfter(call: number): Promise<void>;
}

export class MemoryImageStore implements ImageStore {
	private readonly checkpoints = new Map<number, string>();

	async save({ call, image }: Checkpoint): Promise<void> {
		this.checkpoints.set(call, JSON.stringify(image));
	}

	async latest(): Promise<Checkpoint | undefined> {
		const calls = [...this.checkpoints.keys()];
		return calls.length === 0 ? undefined : this.at(Math.max(...calls));
	}

	async at(call: number): Promise<Checkpoint | undefined> {
		const json = this.checkpoints.get(call);
		return json === undefined ? undefined : { call, image: JSON.parse(json) };
	}

	async dropAfter(call: number): Promise<void> {
		for (const at of [...this.checkpoints.keys()])
			if (at > call) this.checkpoints.delete(at);
	}
}
