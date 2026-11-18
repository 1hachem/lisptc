import { ConversationInterpreter, note } from "@repo/interpreter/conversation";
import { driveAsync, settled } from "@repo/interpreter/drive";
import { StepHold } from "@repo/interpreter/errors";
import { bufferSink, hitch } from "@repo/interpreter/journal";
import { boot, runAsync } from "@repo/interpreter/lisp";
import { str } from "@repo/interpreter/print";
import { newSessionHooks, type SessionHooks } from "@repo/interpreter/session";
import { asksKind } from "@repo/journal-catalog/asks";
import type { Entry } from "@repo/shared/journal";
import { MemoryApprovals } from "../src/approvals.ts";
import {
	type PermissionsExtension,
	permissionsExtension,
} from "../src/permissions.ts";
import { permissionsHostFor } from "../src/permissions-host.ts";
import {
	type ApprovalRequest,
	type Approver,
	MemoryPermissionsStore,
	type PermissionsHost,
} from "../src/ports.ts";

export interface StepRun {
	value?: string;
	failed: boolean;
	held: boolean;
	report: string;
	requests: ApprovalRequest[];
	entries: Entry[];
	message?: string;
}

class OpenedApprovals extends MemoryApprovals {
	readonly opened: ApprovalRequest[] = [];

	override open(request: ApprovalRequest): void {
		this.opened.push(request);
		super.open(request);
	}
}

export interface Session {
	interp: ConversationInterpreter;
	extension: PermissionsExtension;
	hooks: SessionHooks;
	host: PermissionsHost;
	step(code: string): Promise<StepRun>;
	invoke(action: string, values: Record<string, unknown>): Promise<StepRun>;
	turnStart(): Promise<StepRun>;
}

export function session(
	source: string,
	approvers?: readonly Approver[],
	asks?: readonly string[],
	bounds?: readonly string[],
): Session {
	let now = 1_000;
	const approvals = new OpenedApprovals();
	const host: PermissionsHost = {
		...permissionsHostFor({
			store: new MemoryPermissionsStore(source),
			...(approvers === undefined ? {} : { approvers }),
		}),
		approvals,
		clock: { now: () => now++ },
		...(asks === undefined ? {} : { asks }),
		...(bounds === undefined ? {} : { bounds }),
	};
	const extension = permissionsExtension(host);
	const interp = new ConversationInterpreter({ extensions: [extension] });
	boot(interp);
	const hooks = newSessionHooks();
	extension.session?.(hooks);

	async function within(body: () => Promise<unknown>): Promise<StepRun> {
		const buffer = bufferSink();
		const detach = interp.journal.pipe(buffer);
		const opened = approvals.opened.length;
		let value: string | undefined;
		let failed = false;
		let held = false;
		try {
			const result = await body();
			if (result !== undefined) value = str(result);
		} catch (ex) {
			if (ex instanceof StepHold) held = true;
			else failed = true;
		} finally {
			detach();
		}
		const notes = buffer.collect(note).map((record) => record.content);
		const message = notes.length === 0 ? undefined : notes.join("\n\n");
		return {
			...(value === undefined ? {} : { value }),
			failed,
			held,
			report: buffer
				.collect(hitch)
				.filter((n) => n.kind !== "skipped")
				.map((n) => n.text)
				.join(""),
			requests: approvals.opened.slice(opened),
			entries: buffer.entries.filter((e) => e.kind === asksKind.name),
			...(message === undefined ? {} : { message }),
		};
	}

	return {
		interp,
		extension,
		hooks,
		host,
		step: (code) => {
			let value: unknown;
			return within(async () => {
				await hooks.evalStep.run(
					async () => {
						value = (await runAsync(interp, code)).value;
					},
					{ interp, code, author: "assistant" },
				);
				return value;
			});
		},
		invoke: (action, values) =>
			within(() =>
				hooks.invoke.run(
					async () => {
						throw new Error(`nothing handles ${action}`);
					},
					{ interp, action, values },
				),
			),
		turnStart: () =>
			within(async () => {
				await driveAsync(
					hooks.turnStart.run(() => settled(undefined), { interp }),
				);
				return undefined;
			}),
	};
}

export function recordingApprover(): Approver & { asked: ApprovalRequest[] } {
	const asked: ApprovalRequest[] = [];
	return { kind: "recording", asked, ask: (request) => asked.push(request) };
}
