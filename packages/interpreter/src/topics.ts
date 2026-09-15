import { NOTE_TOPIC, topic } from "./channels.ts";

export const output = topic<string>("output");

export interface Note {
	kind: "skipped" | "failed";
	text: string;
	value?: unknown;
}

export const note = topic<Note>(NOTE_TOPIC);
