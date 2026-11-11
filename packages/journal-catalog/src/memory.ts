import { entryKind, every } from "@repo/shared/journal";
import { z } from "zod";

const firedMemory = z.object({
	key: z.string().min(1),
	body: z.string(),
	on: z.string().optional(),
});

export type FiredMemory = z.infer<typeof firedMemory>;

export const memoryKind = entryKind({
	name: "memory",
	schema: firedMemory,
	fold: every,
});

const recognized = z.object({
	message: z.string(),
	step: z.string().optional(),
	scores: z.record(z.string(), z.number().min(0).max(1)),
	fired: z.array(firedMemory).optional(),
	error: z.string().optional(),
});

export type Recognized = z.infer<typeof recognized>;

export const recognizedKind = entryKind({
	name: "recognized",
	schema: recognized,
	fold: every,
});

export const memorySource = "memory";

const notedPrefix = `${memorySource}:`;

export function notedMemorySource(key: string): string {
	return `${notedPrefix}${key}`;
}

export function notedMemoryKey(source: string): string | undefined {
	return source.startsWith(notedPrefix)
		? source.slice(notedPrefix.length)
		: undefined;
}

export function isMemorySource(source: string | undefined): boolean {
	return source === memorySource || source?.startsWith(notedPrefix) === true;
}
