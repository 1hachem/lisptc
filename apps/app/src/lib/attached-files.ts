import { readAnnotation } from "@repo/interpreter/annotations";
import {
	type AttachedFile,
	attachmentsKey,
} from "@repo/knowledge-extension/attached";
import type { ChatMessage } from "./chat.tsx";

export function attachedFiles(message: ChatMessage): AttachedFile[] {
	return readAnnotation(message.additional_kwargs, attachmentsKey) ?? [];
}

export function attachingFiles(
	names: readonly string[],
): Record<string, unknown> | undefined {
	if (names.length === 0) return undefined;
	const attachments: AttachedFile[] = names.map((name) => ({
		folder: "attachments",
		name,
	}));
	return { [attachmentsKey.name]: attachments };
}
