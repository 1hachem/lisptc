import type { GraphNode } from "@repo/interpreter/graph";
import { nodeToJson, type UiValue } from "@repo/interpreter/ui";
import { evalCode, replResultContent } from "./repl.ts";
import { getThreadRepl } from "./repl-store.ts";

export interface EvalMessage {
	type: "tool";
	content: string;
	id: string;
	additional_kwargs?: {
		display?: string;
		ui?: UiValue;
		failed?: boolean;
		graph?: GraphNode[];
	};
}

export async function evalUserCode(
	code: string,
	threadId?: string,
): Promise<EvalMessage> {
	const repl = getThreadRepl(threadId);
	const { output, display, error, failed, ui, graph } = await evalCode(
		repl,
		code,
	);
	repl.clearTurnSignals();
	const extras: EvalMessage["additional_kwargs"] = {};
	if (display !== output) extras.display = display;
	if (ui) extras.ui = nodeToJson(ui);
	if (failed) extras.failed = true;
	if (graph.length > 0) extras.graph = graph;
	return {
		type: "tool",
		content: replResultContent(output, error),
		id: crypto.randomUUID(),
		...(Object.keys(extras).length > 0 ? { additional_kwargs: extras } : {}),
	};
}
