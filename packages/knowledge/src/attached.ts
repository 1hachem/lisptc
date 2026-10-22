import { annotationKey } from "@repo/interpreter/annotations";
import { z } from "zod";
import { STORE_FOLDERS } from "./ports.ts";

const attachedFile = z.object({
	folder: z.enum(STORE_FOLDERS),
	name: z.string().min(1),
});

export type AttachedFile = z.infer<typeof attachedFile>;

export const attachmentsKey = annotationKey({
	name: "attachments",
	lane: "output",
	schema: z.array(attachedFile),
});
