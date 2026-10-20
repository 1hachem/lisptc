import { topic } from "./channels.ts";

export type Effect = { readonly type: "end" } | { readonly type: "quiet" };

export const effect = topic<Effect>("effect");

export function ends(effects: readonly Effect[]): boolean {
	return effects.some((e) => e.type === "end");
}

export function quiets(effects: readonly Effect[]): boolean {
	return effects.some((e) => e.type === "quiet");
}
