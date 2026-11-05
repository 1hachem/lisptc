import { latestOnly } from "@repo/shared/journal";
import { z } from "zod";

const viewRef = z.object({ viewId: z.string() });

export type ViewRef = z.infer<typeof viewRef>;

export const viewKind = latestOnly({ name: "ui", schema: viewRef });
