import type {
	CustomMessageEntryDraft,
	ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import {
	evalCode,
	MAX_STEPS,
	replResultContent,
	systemPromptFor,
} from "@repo/ai";
import { AgentRepl } from "@repo/repl/repl";
import {
	capped,
	conversationVars,
	messageText,
	stepCode,
	turnsFrom,
} from "./bridge.ts";
import { piExtensions } from "./extensions.ts";
import { renderResult } from "./render.ts";

const RESULT = "lisptc-result";
const RIDING = "lisptc-riding";

export default function lisptc(pi: ExtensionAPI): void {
	let repl: AgentRepl | undefined;

	const open = (): AgentRepl => {
		repl ??= new AgentRepl({ extensions: piExtensions() });
		return repl;
	};

	const riding = (text: string): CustomMessageEntryDraft => ({
		type: "custom_message",
		customType: RIDING,
		content: text,
		display: false,
	});

	pi.registerMessageRenderer(RESULT, renderResult);

	pi.on("session_start", () => {
		open();
		pi.setActiveTools([]);
	});

	pi.on("before_agent_start", () => {
		const active = open();
		const withheld = active.takeProseFeedback();
		return {
			systemPrompt: systemPromptFor(active.interp),
			...(withheld
				? {
						message: {
							customType: RIDING,
							content: withheld,
							display: false,
						},
					}
				: {}),
		};
	});

	pi.on("turn_end", async (event) => {
		const { message } = event;
		if (message.role !== "assistant") return;

		const active = open();
		const code = stepCode(messageText(message.content));
		if (code === undefined) return;

		active.setConversationVars(
			conversationVars(turnsFrom(event.context.contextMessages)),
		);

		const { output, display, error, annotations, failed } = await evalCode(
			active,
			code,
		);

		const entries: CustomMessageEntryDraft[] = [
			{
				type: "custom_message",
				customType: RESULT,
				content: replResultContent(output, error, annotations.step),
				display: true,
				details: { display: display || output, error, failed },
			},
		];

		if (active.takeFinished() || capped(event.turnIndex, MAX_STEPS))
			return { entries };

		const { emitted } = await active.beginTurn();
		if (emitted !== "") entries.push(riding(emitted));

		return { entries, continue: true };
	});

	pi.on("session_shutdown", () => {
		repl?.interp.dispose();
		repl = undefined;
	});
}
