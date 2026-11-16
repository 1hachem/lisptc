import { HITCH_TOPIC, topic } from "./channels.ts";

export const output = topic<string>("output");

export interface Hitch {
	kind: "skipped" | "failed" | "held";
	text: string;
}

export const hitch = topic<Hitch>(HITCH_TOPIC);
