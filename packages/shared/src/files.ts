import { z } from "zod";

export const STORE_FOLDERS = ["attachments", "knowledge"] as const;

export type StoreFolder = (typeof STORE_FOLDERS)[number];

export const MAX_FILE_NAME = 128;

const MAX_EXTENSION = 16;
const INVISIBLE = /[\p{Cc}​-‏‪-‮⁠-⁩]/gu;
const UNSAFE = /[/\\\p{Cc}​-‏‪-‮⁠-⁩]/u;

export function isFileName(name: string): boolean {
	return (
		name.length > 0 &&
		name.length <= MAX_FILE_NAME &&
		name.trim() === name &&
		!name.startsWith(".") &&
		!UNSAFE.test(name)
	);
}

function clip(text: string, units: number): string {
	const cut = text.slice(0, Math.max(units, 0));
	return /[\ud800-\udbff]$/.test(cut) ? cut.slice(0, -1) : cut;
}

export function fittedFileName(name: string, tag = ""): string {
	const dot = name.lastIndexOf(".");
	const split = dot > 0 && name.length - dot <= MAX_EXTENSION;
	const stem = split ? name.slice(0, dot) : name;
	const extension = split ? name.slice(dot) : "";
	const room = MAX_FILE_NAME - tag.length - extension.length;
	return `${clip(stem, room).trimEnd()}${tag}${extension}`;
}

export function sanitizeFileName(raw: string): string | null {
	const cleaned = raw
		.normalize("NFC")
		.replace(/\s+/gu, " ")
		.replace(INVISIBLE, "")
		.replace(/[/\\]+/g, "-")
		.trim()
		.replace(/^[.\s]+/u, "");
	if (cleaned === "") return null;
	const fitted = fittedFileName(cleaned);
	return isFileName(fitted) ? fitted : null;
}

export const ATTACHMENTS_ANNOTATION = "attachments";

const attachedFile = z.object({
	folder: z.enum(STORE_FOLDERS),
	name: z.string().refine(isFileName, "not a file name"),
});

export const attachedFiles = z.array(attachedFile);

export type AttachedFile = z.infer<typeof attachedFile>;
