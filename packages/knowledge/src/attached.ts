import { entryKind } from "@repo/interpreter/journal";
import { ATTACHMENTS_KIND, attachedFiles } from "@repo/shared/files";

export const attachmentsKind = entryKind({
	name: ATTACHMENTS_KIND,
	schema: attachedFiles,
});
