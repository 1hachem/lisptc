import { entryKind, every } from "@repo/shared/journal";
import { z } from "zod";

export type Effect = { readonly type: "end" } | { readonly type: "quiet" };

export const effect = entryKind<Effect, Effect[]>({
	name: "effect",
	schema: z.union([
		z.object({ type: z.literal("end") }),
		z.object({ type: z.literal("quiet") }),
	]),
	fold: every,
});

export function ends(effects: readonly Effect[]): boolean {
	return effects.some((e) => e.type === "end");
}

export function quiets(effects: readonly Effect[]): boolean {
	return effects.some((e) => e.type === "quiet");
}
