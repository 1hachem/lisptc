import type { StepAnnotations } from "@repo/interpreter/session";
import type { MessageKwargs } from "@repo/shared/messages";
import { replResultContent } from "./repl.ts";

export interface ToolMessage {
	type: "tool";
	content: string;
	id: string;
	additional_kwargs?: MessageKwargs;
}

export interface ToolOutcome {
	output: string;
	display: string;
	error: boolean;
	failed: boolean;
	failure?: string;
	riding?: string;
	results: readonly string[];
	annotations: StepAnnotations;
	quiet?: boolean;
}

export function toolMessage(outcome: ToolOutcome, id: string): ToolMessage {
	const extras: MessageKwargs = { ...outcome.annotations.output };
	if (outcome.display !== "") extras.display = outcome.display;
	if (outcome.failed) extras.failed = true;
	if (outcome.failure) extras.failure = outcome.failure;
	if (outcome.riding !== undefined) extras.riding = outcome.riding;
	if (outcome.results.length > 0) extras.results = [...outcome.results];
	if (outcome.quiet) extras.quiet = true;
	return {
		type: "tool",
		content: replResultContent(outcome.output, outcome.error),
		id,
		...(Object.keys(extras).length > 0 ? { additional_kwargs: extras } : {}),
	};
}
