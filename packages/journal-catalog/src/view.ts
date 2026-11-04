import { entryKind } from "@repo/shared/journal";
import { z } from "zod";

const viewRef = z.object({ viewId: z.string() });

export type ViewRef = z.infer<typeof viewRef>;

export const viewKind = entryKind({ name: "ui", schema: viewRef });
