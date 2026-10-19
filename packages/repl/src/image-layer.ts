import type { Image, Json } from "@repo/interpreter/image";

interface Spliced<T> {
	readonly keep: number;
	readonly tail: T[];
}

interface Patched<T> {
	readonly set: Record<string, T>;
	readonly drop: string[];
}

export interface Layer {
	readonly format: number;
	readonly whole: boolean;
	readonly objects: Spliced<Json>;
	readonly globals: Spliced<Image["globals"][number]>;
	readonly docs: Patched<Image["docs"][string]>;
	readonly sources: Patched<Json>;
}

function same(a: unknown, b: unknown): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
}

function splice<T>(below: readonly T[], above: readonly T[]): Spliced<T> {
	let keep = 0;
	while (
		keep < below.length &&
		keep < above.length &&
		same(below[keep], above[keep])
	)
		keep++;
	return { keep, tail: above.slice(keep) };
}

function patch<T>(
	below: Record<string, T>,
	above: Record<string, T>,
): Patched<T> {
	const set: Record<string, T> = {};
	for (const [key, value] of Object.entries(above))
		if (!(key in below) || !same(below[key], value)) set[key] = value;
	return { set, drop: Object.keys(below).filter((key) => !(key in above)) };
}

function empty(format: number): Image {
	return { format, objects: [], globals: [], docs: {}, sources: {} };
}

export function layerOver(below: Image | undefined, image: Image): Layer {
	const base = below === undefined || below.format !== image.format;
	const under = base ? empty(image.format) : below;
	return {
		format: image.format,
		whole: base,
		objects: splice(under.objects, image.objects),
		globals: splice(under.globals, image.globals),
		docs: patch(under.docs, image.docs),
		sources: patch(under.sources, image.sources),
	};
}

function spliced<T>(below: readonly T[], { keep, tail }: Spliced<T>): T[] {
	if (keep > below.length)
		throw new Error(`a layer keeps ${keep} of ${below.length} entries`);
	return [...below.slice(0, keep), ...tail];
}

function patched<T>(
	below: Record<string, T>,
	{ set, drop }: Patched<T>,
): Record<string, T> {
	const out = { ...below, ...set };
	for (const key of drop) delete out[key];
	return out;
}

export function stack(layers: readonly Layer[]): Image {
	const [first] = layers;
	if (first === undefined || !first.whole)
		throw new Error("a stack of layers starts from a whole one");
	let image = empty(first.format);
	for (const layer of layers) {
		const under = layer.whole ? empty(layer.format) : image;
		image = {
			format: layer.format,
			objects: spliced(under.objects, layer.objects),
			globals: spliced(under.globals, layer.globals),
			docs: patched(under.docs, layer.docs),
			sources: patched(under.sources, layer.sources),
		};
	}
	return image;
}
