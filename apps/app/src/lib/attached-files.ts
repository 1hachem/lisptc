import type { ChatMessage } from "./chat.tsx";

export type AttachedFolder = "attachments" | "knowledge";

export interface AttachedFile {
	folder: AttachedFolder;
	name: string;
}

const FOLDERS: readonly AttachedFolder[] = ["attachments", "knowledge"];

function isAttachedFile(value: unknown): value is AttachedFile {
	if (typeof value !== "object" || value === null) return false;
	const { folder, name } = value as Record<string, unknown>;
	return (
		FOLDERS.includes(folder as AttachedFolder) &&
		typeof name === "string" &&
		name !== ""
	);
}

export function attachedFiles(message: ChatMessage): AttachedFile[] {
	const attachments = message.additional_kwargs?.attachments;
	return Array.isArray(attachments) ? attachments.filter(isAttachedFile) : [];
}

export function attachingFiles(
	names: readonly string[],
): Record<string, unknown> | undefined {
	if (names.length === 0) return undefined;
	const attachments: AttachedFile[] = names.map((name) => ({
		folder: "attachments",
		name,
	}));
	return { attachments };
}
