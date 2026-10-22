import { annotate, readAnnotation } from "@repo/interpreter/annotations";
import { topic } from "@repo/interpreter/channels";
import { type Eval, settled } from "@repo/interpreter/drive";
import { EvalException } from "@repo/interpreter/errors";
import type { Interp } from "@repo/interpreter/lisp";
import { zString } from "@repo/interpreter/schema";
import type { InterpExtension, SessionHooks } from "@repo/interpreter/session";
import { type AttachedFile, STORE_FOLDERS } from "@repo/shared/files";
import { z } from "zod";
import { attachmentsKey } from "./attached.ts";
import { ATTACHMENT_ASKS, registerAttachments } from "./attachment-forms.ts";
import { BIN_ASKS, registerBin } from "./bin-forms.ts";
import { KNOWLEDGE_ASKS, registerKnowledge } from "./knowledge-forms.ts";
import { fileName } from "./names.ts";
import type { KnowledgeHost } from "./ports.ts";

export interface KnowledgeExtension extends InterpExtension {
	readonly asks: readonly string[];
}

export const attached = topic<AttachedFile>("attachments");

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
				attached.emit(interp.channels, { user: { folder, name: checked } });
				return checked;
			},
		);
}

function attachSession(hooks: SessionHooks): void {
	hooks.received.use(function* (ctx, received, next) {
		const files = readAnnotation(received, attachmentsKey) ?? [];
		if (files.length > 0)
			ctx.emit(
				`user attached: ${files.map(({ folder, name }) => `${folder}/${name}`).join(", ")}`,
			);
		yield* next(ctx, received);
	});
	hooks.annotate.use((buffer, into, next) => {
		const attachments = buffer.collect(attached);
		return next(
			buffer,
			attachments.length === 0
				? into
				: annotate(into, attachmentsKey, attachments),
		);
	});
}

export function knowledgeExtension(host: KnowledgeHost): KnowledgeExtension {
	return Object.assign(
		(interp: Interp): void => {
			registerAttachments(interp, host);
			registerKnowledge(interp, host);
			registerAttach(interp, host);
			registerBin(interp, host);
		},
		{
			asks: [...KNOWLEDGE_ASKS, ...ATTACHMENT_ASKS, ...BIN_ASKS],
			prompt: host.prompt(),
			session: attachSession,
		},
	);
}
