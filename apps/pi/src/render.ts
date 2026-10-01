import type { MessageRenderer } from "@earendil-works/pi-coding-agent";
import { Box, Text } from "@earendil-works/pi-tui";

export interface ResultDetails {
	readonly display: string;
	readonly error: boolean;
	readonly failed: boolean;
}

const PLAIN: ResultDetails = { display: "", error: false, failed: false };

export function tone(details: ResultDetails): "error" | "warning" | "success" {
	if (details.error) return "error";
	if (details.failed) return "warning";
	return "success";
}

export const renderResult: MessageRenderer<ResultDetails> = (
	message,
	{ expanded, outputPad },
	theme,
) => {
	const details = message.details ?? PLAIN;
	const lines = [
		theme.fg(tone(details), details.error ? "repl error" : "repl"),
	];
	if (details.display) lines.push(details.display);
	if (expanded) lines.push(theme.fg("dim", String(message.content)));

	const box = new Box(outputPad, 1, (t) => theme.bg("customMessageBg", t));
	box.addChild(new Text(lines.join("\n"), 0, 0));
	return box;
};
