import {
	ATTACHMENTS_ANNOTATION,
	type AttachedFile,
	attachedFiles,
} from "@repo/shared/files";
import type { ChatMessage } from "./chat.tsx";

export function attachedTo(message: ChatMessage): AttachedFile[] {
	return (
		attachedFiles.safeParse(message.additional_kwargs?.[ATTACHMENTS_ANNOTATION])
			.data ?? []
	);
}

export function attachingFiles(
	names: readonly string[],
): Record<string, unknown> | undefined {
	if (names.length === 0) return undefined;
	const attachments: AttachedFile[] = names.map((name) => ({
		folder: "attachments",
		name,
	}));
	return { [ATTACHMENTS_ANNOTATION]: attachments };
}
