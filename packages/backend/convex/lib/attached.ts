import { ATTACHMENTS_ANNOTATION, attachedFiles } from "@repo/shared/files";
import { ConvexError } from "convex/values";

export function checkAttachments(
	kwargs: Record<string, unknown> | undefined,
): void {
	if (kwargs === undefined || !(ATTACHMENTS_ANNOTATION in kwargs)) return;
	if (!attachedFiles.safeParse(kwargs[ATTACHMENTS_ANNOTATION]).success)
		throw new ConvexError({ code: "MALFORMED_ATTACHMENTS" });
}
