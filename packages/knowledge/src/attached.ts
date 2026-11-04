import { ATTACHMENTS_KIND, attachedFiles } from "@repo/shared/files";
import { entryKind, every } from "@repo/shared/journal";

export const attachmentsKind = entryKind({
	name: ATTACHMENTS_KIND,
	schema: attachedFiles,
	fold: every,
});
