import { annotationKey } from "@repo/interpreter/annotations";
import { ATTACHMENTS_ANNOTATION, attachedFiles } from "@repo/shared/files";

export const attachmentsKey = annotationKey({
	name: ATTACHMENTS_ANNOTATION,
	lane: "output",
	schema: attachedFiles,
});
