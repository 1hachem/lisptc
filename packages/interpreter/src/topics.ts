import { NOTE_TOPIC, topic } from "./channels.ts";

export const output = topic<string>("output");

export interface Note {
	kind: "skipped" | "failed" | "held";
	text: string;
}

export const note = topic<Note>(NOTE_TOPIC);
