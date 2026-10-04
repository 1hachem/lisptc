import { bufferTransport } from "@repo/interpreter/channels-host";
import { StepHold } from "@repo/interpreter/errors";
import { Interp, runAsync, runSync } from "@repo/interpreter/lisp";
import { prelude } from "@repo/interpreter/prelude";
import { str } from "@repo/interpreter/print";
import {
	newSessionHooks,
	noAnnotations,
	type SessionHooks,
	type StepAnnotations,
} from "@repo/interpreter/session";
import { note } from "@repo/interpreter/topics";
import { requested } from "../src/channel.ts";
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
	annotations: StepAnnotations;
	message?: string;
}

export interface Session {
	interp: Interp;
	extension: PermissionsExtension;
	hooks: SessionHooks;
	host: PermissionsHost;
	step(code: string): Promise<StepRun>;
	invoke(action: string, values: Record<string, unknown>): Promise<StepRun>;
}

export function session(
	source: string,
	approvers?: readonly Approver[],
): Session {
	let now = 1_000;
	const host: PermissionsHost = {
		...permissionsHostFor({
			store: new MemoryPermissionsStore(source),
			...(approvers === undefined ? {} : { approvers }),
		}),
		clock: { now: () => now++ },
	};
	const extension = permissionsExtension(host);
	const interp = new Interp({ extensions: [extension] });
	runSync(interp, prelude);
	const hooks = newSessionHooks();
	extension.session?.(hooks);

	async function within(body: () => Promise<unknown>): Promise<StepRun> {
		const buffer = bufferTransport();
		const detach = interp.channels.pipe(buffer);
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
		const message = hooks.message.run(() => undefined, buffer);
		return {
			...(value === undefined ? {} : { value }),
			failed,
			held,
			report: buffer
				.collect(note)
				.filter((n) => n.kind !== "skipped")
				.map((n) => n.text)
				.join(""),
			requests: buffer.collect(requested),
			annotations: hooks.annotate.run(
				(_b, into) => into,
				buffer,
				noAnnotations(),
			),
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
					{ interp, code, emit: () => {} },
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
	};
}

export function recordingApprover(): Approver & { asked: ApprovalRequest[] } {
	const asked: ApprovalRequest[] = [];
	return { kind: "recording", asked, ask: (request) => asked.push(request) };
}
