import type { ChatMessage } from "./chat.tsx";

export type AttachedFolder = "attachments" | "knowledge";

export interface AttachedFile {
	folder: AttachedFolder;
	name: string;
}

const FOLDERS: readonly AttachedFolder[] = ["attachments", "knowledge"];

const LEGACY_FOLDERS: Record<string, AttachedFolder> = { bin: "attachments" };

const ATTACHED_LINE = /\n*^attached: (.+)$(?![\s\S])/m;

function isAttachedFile(value: unknown): value is AttachedFile {
	if (typeof value !== "object" || value === null) return false;
	const { folder, name } = value as Record<string, unknown>;
	return (
		FOLDERS.includes(folder as AttachedFolder) &&
		typeof name === "string" &&
		name !== ""
	);
}

export function toolAttachments(message: ChatMessage): AttachedFile[] {
	const attachments = message.additional_kwargs?.attachments;
	return Array.isArray(attachments) ? attachments.filter(isAttachedFile) : [];
}

function attachedPath(path: string): AttachedFile | undefined {
	const slash = path.indexOf("/");
	if (slash <= 0) return undefined;
	const prefix = path.slice(0, slash);
	const folder = FOLDERS.find((f) => f === prefix) ?? LEGACY_FOLDERS[prefix];
	const name = path.slice(slash + 1);
	return folder && name !== "" ? { folder, name } : undefined;
}

export function userAttachments(text: string): {
	text: string;
	files: AttachedFile[];
} {
	const match = ATTACHED_LINE.exec(text);
	if (match === null) return { text, files: [] };
	const paths = match[1].split(/, (?=(?:attachments|knowledge|bin)\/)/);
	const files = paths.map(attachedPath);
	if (files.some((file) => file === undefined)) return { text, files: [] };
	return {
		text: text.slice(0, match.index),
		files: files as AttachedFile[],
	};
}
