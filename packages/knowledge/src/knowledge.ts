import { type Eval, settled } from "@repo/interpreter/drive";
import { EvalException } from "@repo/interpreter/errors";
import { record } from "@repo/interpreter/journal";
import type { Interp } from "@repo/interpreter/lisp";
import { newSym } from "@repo/interpreter/objects";
import { zString } from "@repo/interpreter/schema";
import type { InterpExtension, SessionHooks } from "@repo/interpreter/session";
import { STORE_FOLDERS } from "@repo/shared/files";
import { readReceived } from "@repo/shared/journal";
import { z } from "zod";
import { attachmentsKind } from "./attached.ts";
import { ATTACHMENT_ASKS, registerAttachments } from "./attachment-forms.ts";
import { BIN_ASKS, registerBin } from "./bin-forms.ts";
import { KNOWLEDGE_ASKS, registerKnowledge } from "./knowledge-forms.ts";
import { fileName } from "./names.ts";
import type { KnowledgeHost } from "./ports.ts";

export interface KnowledgeExtension extends InterpExtension {
	readonly asks: readonly string[];
}

function registerAttach(interp: Interp, { store }: KnowledgeHost): void {
	for (const folder of STORE_FOLDERS)
		interp.defGen(
			`${folder}/attach`,
			1,
			`(${folder}/attach "name")`,
			`Attach a ${folder} file to your reply, so the user sees it under the message and opens it with a click. Errors when there is no such file. Returns the name.`,
			z.tuple([zString]),
			function* ([name]): Eval {
				const checked = fileName(name);
				if (!(yield* settled(store.names(folder))).includes(checked))
					throw new EvalException(
						`no file named ${checked} in ${folder}`,
						name,
					);
				record(interp.channels, attachmentsKind, [{ folder, name: checked }]);
				return checked;
			},
		);
}

function attachSession(hooks: SessionHooks): void {
	hooks.received.use(function* (ctx, received, next) {
		const files = readReceived(received, attachmentsKind) ?? [];
		if (files.length > 0)
			ctx.interp.conversation.append(
				"knowledge",
				`${ATTACHED_NOTE}${files.map(({ folder, name }) => `${folder}/${name}`).join(", ")}`,
			);
		yield* next(ctx, received);
	});
}

const ATTACHED_NOTE = "user attached: ";

const DAY_MS = 86_400_000;

function registerExpiry(interp: Interp, host: KnowledgeHost): void {
	interp.defineGlobal(newSym("*knowledge-attached-note*"), ATTACHED_NOTE, {
		signature: "*knowledge-attached-note*",
		doc: "The note an attachment carries while it is kept in the attachments folder.",
	});
	interp.defineGlobal(
		newSym("*knowledge-attachment-days*"),
		BigInt(Math.round(host.attachmentTtlMs / DAY_MS)),
		{
			signature: "*knowledge-attachment-days*",
			doc: "How many days an unkept attachment stays before it moves to the bin.",
		},
	);
	interp.defineGlobal(
		newSym("*knowledge-bin-days*"),
		BigInt(Math.round(host.binTtlMs / DAY_MS)),
		{
			signature: "*knowledge-bin-days*",
			doc: "How many days a file stays in the bin before it is deleted for good.",
		},
	);
}

export function knowledgeExtension(host: KnowledgeHost): KnowledgeExtension {
	return Object.assign(
		(interp: Interp): void => {
			registerAttachments(interp, host);
			registerKnowledge(interp, host);
			registerAttach(interp, host);
			registerBin(interp, host);
			registerExpiry(interp, host);
		},
		{
			asks: [...KNOWLEDGE_ASKS, ...ATTACHMENT_ASKS, ...BIN_ASKS],
			prompt: host.prompt(),
			memories: host.memories(),
			session: attachSession,
		},
	);
}
