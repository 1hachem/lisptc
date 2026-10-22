import { formsIn } from "@repo/syntax";

export type AgentStatus =
	| "thinking"
	| "writing"
	| "learning"
	| "preparing"
	| "steering"
	| "waiting";

const LEARNING_HEADS = ["memory/", "knowledge/", "attachments/", "bin/"];

function learns(head: string): boolean {
	return head === "memories" || LEARNING_HEADS.some((p) => head.startsWith(p));
}

function prepares(head: string): boolean {
	return head.startsWith("ui/");
}

const LINES: Record<AgentStatus, readonly string[]> = {
	thinking: [
		"thinking",
		"mulling it over",
		"working it out",
		"chewing on it",
		"weighing the options",
		"balancing parentheses",
	],
	writing: [
		"writing",
		"putting it into words",
		"typing away",
		"drafting",
		"spelling it out",
	],
	learning: [
		"learning",
		"looking through what I know",
		"checking my notes",
		"reading up",
		"jogging my memory",
	],
	preparing: [
		"preparing",
		"setting things up",
		"laying it out",
		"putting the pieces in place",
		"getting the view ready",
	],
	steering: [
		"reading your note",
		"taking that on board",
		"adjusting course",
		"noted, folding it in",
	],
	waiting: [
		"waiting on you",
		"your turn",
		"over to you",
		"standing by for your answer",
	],
};

export function agentStatus({
	loading,
	writing,
	queued,
	asking,
}: {
	loading: boolean;
	writing: string | undefined;
	queued: number;
	asking: boolean;
}): AgentStatus | undefined {
	if (!loading) return asking ? "waiting" : undefined;
	if (queued > 0) return "steering";
	if (writing === undefined) return "thinking";
	const { heads } = formsIn(writing);
	if (heads.some(prepares)) return "preparing";
	if (heads.some(learns)) return "learning";
	return "writing";
}

export function pickStatusLine(
	status: AgentStatus,
	roll: number = Math.random(),
): string {
	const lines = LINES[status];
	return lines[Math.floor(roll * lines.length) % lines.length] ?? status;
}
