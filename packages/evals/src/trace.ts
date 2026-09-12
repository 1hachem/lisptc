import { MODEL, type Severity } from "@repo/interpreter/channels";
import { type Interp, type InterpExtension, str } from "@repo/interpreter/lisp";
import type { Dispatch } from "@repo/interpreter/promises";
import type { SecretsStore } from "@repo/interpreter/secrets";

export const REDACTED = "<redacted>";

const MAX_RENDERED = 400;

export type TraceEvent =
	| { kind: "reply"; step: number; code: string }
	| {
			kind: "form";
			step: number;
			form: string;
			value: string;
			error?: string;
	  }
	| {
			kind: "tool";
			step: number;
			server: string;
			tool: string;
			args: Record<string, unknown>;
			ok: boolean;
	  }
	| { kind: "connect"; step: number; server: string; ok: boolean }
	| { kind: "note"; step: number; severity: Severity; text: string }
	| { kind: "halt"; step: number; answer: string };

interface ConnectResult {
	serverId: string;
	tools: unknown[];
}

interface CallToolPayload {
	serverId: string;
	tool: string;
	args: Record<string, unknown>;
}

function clip(text: string): string {
	return text.length > MAX_RENDERED ? `${text.slice(0, MAX_RENDERED)}…` : text;
}

function message(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

export class Trace {
	readonly events: TraceEvent[] = [];
	private readonly sources = new Map<number, unknown>();
	private step = 0;
	private readonly servers = new Map<string, string>();
	private readonly secrets: SecretsStore | undefined;

	constructor(options: { secrets?: SecretsStore } = {}) {
		this.secrets = options.secrets;
	}

	beginStep(step: number): void {
		this.step = step;
	}

	add(event: TraceEvent, source?: unknown): void {
		if (source !== undefined) this.sources.set(this.events.length, source);
		this.events.push(event);
	}

	get currentStep(): number {
		return this.step;
	}

	sourceAt(index: number): unknown {
		return this.sources.get(index);
	}

	reply(code: string): void {
		this.add({ kind: "reply", step: this.step, code });
	}

	halt(answer = ""): void {
		this.add({ kind: "halt", step: this.step, answer: clip(answer) });
	}

	extension(): InterpExtension {
		return (interp: Interp): void => {
			const trace = this;
			interp.hooks.evalForm.use(function* (host, form, next) {
				try {
					const value = yield* next(host, form);
					trace.add(
						{
							kind: "form",
							step: trace.step,
							form: clip(str(form)),
							value: clip(str(value)),
						},
						form,
					);
					return value;
				} catch (err) {
					trace.add(
						{
							kind: "form",
							step: trace.step,
							form: clip(str(form)),
							value: "",
							error: message(err),
						},
						form,
					);
					throw err;
				}
			});
			interp.channels.on(MODEL, (d) => {
				if (!d.severity) return;
				trace.add({
					kind: "note",
					step: trace.step,
					severity: d.severity,
					text: d.text,
				});
			});
		};
	}

	dispatch(inner: Dispatch): Dispatch {
		return async (op, payload, signal) => {
			if (op === "connect") return this.recordConnect(inner, payload, signal);
			if (op === "call-tool") return this.recordCall(inner, payload, signal);
			return inner(op, payload, signal);
		};
	}

	private async recordConnect(
		inner: Dispatch,
		payload: unknown,
		signal?: AbortSignal,
	): Promise<unknown> {
		const server = (payload as { name?: string }).name ?? "";
		try {
			const result = (await inner("connect", payload, signal)) as ConnectResult;
			this.servers.set(result.serverId, server);
			this.add({ kind: "connect", step: this.step, server, ok: true });
			return result;
		} catch (err) {
			this.add({ kind: "connect", step: this.step, server, ok: false });
			throw err;
		}
	}

	private async recordCall(
		inner: Dispatch,
		payload: unknown,
		signal?: AbortSignal,
	): Promise<unknown> {
		const { serverId, tool, args } = payload as CallToolPayload;
		const server = this.servers.get(serverId) ?? serverId;
		const safe = this.redact(args) as Record<string, unknown>;
		try {
			const result = await inner("call-tool", payload, signal);
			this.add({
				kind: "tool",
				step: this.step,
				server,
				tool,
				args: safe,
				ok: true,
			});
			return result;
		} catch (err) {
			this.add({
				kind: "tool",
				step: this.step,
				server,
				tool,
				args: safe,
				ok: false,
			});
			throw err;
		}
	}

	private secretValues(): string[] {
		if (!this.secrets) return [];
		return this.secrets
			.list()
			.map(([key]) => this.secrets?.get(key)?.value)
			.filter((value): value is string => Boolean(value));
	}

	private redact(value: unknown): unknown {
		const secrets = this.secretValues();
		if (secrets.length === 0) return value;
		return scrub(value, secrets);
	}
}

function scrub(value: unknown, secrets: string[]): unknown {
	if (typeof value === "string") {
		let out = value;
		for (const secret of secrets) out = out.split(secret).join(REDACTED);
		return out;
	}
	if (Array.isArray(value)) return value.map((item) => scrub(item, secrets));
	if (value !== null && typeof value === "object")
		return Object.fromEntries(
			Object.entries(value).map(([key, item]) => [key, scrub(item, secrets)]),
		);
	return value;
}
