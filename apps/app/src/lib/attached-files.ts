import {
	ATTACHMENTS_KIND,
	type AttachedFile,
	attachedFiles,
} from "@repo/shared/files";
import type { ChatMessage } from "./chat.tsx";
import { entriesOfMessage } from "./entries.ts";

function filesIn(value: unknown): AttachedFile[] {
	return attachedFiles.safeParse(value).data ?? [];
}

export function attachedTo(message: ChatMessage): AttachedFile[] {
	return [
		...filesIn(message.additional_kwargs?.[ATTACHMENTS_KIND]),
		...entriesOfMessage(message)
			.filter((entry) => entry.kind === ATTACHMENTS_KIND)
			.flatMap((entry) => filesIn(entry.value)),
	];
}

export function attachingFiles(
	names: readonly string[],
): Record<string, unknown> | undefined {
	if (names.length === 0) return undefined;
	const attachments: AttachedFile[] = names.map((name) => ({
		folder: "attachments",
		name,
	}));
	return { [ATTACHMENTS_KIND]: attachments };
}
