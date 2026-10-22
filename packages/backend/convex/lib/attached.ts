import { attachmentsKey } from "@repo/knowledge-extension/attached";
import { ConvexError } from "convex/values";

export function checkAttachments(
	kwargs: Record<string, unknown> | undefined,
): void {
	if (kwargs === undefined || !(attachmentsKey.name in kwargs)) return;
	if (!attachmentsKey.schema.safeParse(kwargs[attachmentsKey.name]).success)
		throw new ConvexError({ code: "MALFORMED_ATTACHMENTS" });
}
