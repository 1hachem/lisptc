import { EvalException, StepHold } from "@repo/interpreter/errors";
import { type Interp, runSync } from "@repo/interpreter/lisp";
import { arrayToList, Cell, newSym, Sym } from "@repo/interpreter/objects";
import { str } from "@repo/interpreter/print";
import { Reader } from "@repo/interpreter/reader";
import { zAny, zList, zString, zSym } from "@repo/interpreter/schema";
import type { InterpExtension, SessionHooks } from "@repo/interpreter/session";
import { z } from "zod";
import { requested } from "./channel.ts";
import type {
	ApprovalRequest,
	PermissionsHost,
	Ruling,
	ServerAccess,
} from "./ports.ts";
import { type PermissionRules, parseRules, RULE_FORMS } from "./rules.ts";

const MAX_ARGS_CHARS = 400;

const OWN_FORMS = "permission/";

const DELETE_FORM = "permission/delete";

const DELETE_SYM = newSym(DELETE_FORM);

function deleted(form: Cell): unknown {
	const rest = form.cdr;
	if (!(rest instanceof Cell) || rest.cdr !== null)
		throw new EvalException(
			"permission/delete takes one form, as permission/list shows it",
			form,
			false,
		);
	return rest.car;
}

export class PermissionRefusal extends EvalException {
	constructor(
		readonly name: string,
		readonly report: string,
	) {
		super(report, name, false);
	}
}

export class SessionRules {
	private readonly asks: ReadonlySet<string>;

	constructor(
		private held: PermissionRules,
		asks: readonly string[] = [],
	) {
		this.asks = new Set(asks);
	}

	get current(): PermissionRules {
		return this.held;
	}

	replace(next: PermissionRules): void {
		this.held = next;
	}

	decide(name: string): Ruling {
		const ruling = this.held.decide(name);
		if (
			ruling.verdict !== "allow" ||
			!this.asks.has(name) ||
			this.held.named(name) !== undefined
		)
			return ruling;
		return { verdict: "ask" };
	}

	server(name: string): ServerAccess {
		return this.held.server(name);
	}

	tool(server: string, tool: string): boolean {
		return this.held.tool(server, tool);
	}
}

export interface PermissionsExtension extends InterpExtension {
	readonly rules: SessionRules;
}

export function permissionsExtension(
	host: PermissionsHost,
): PermissionsExtension {
	const rules = new SessionRules(parseRules(host.store.source()), host.asks);
	let armed = 0;
	let issued = 0;

	async function armedWhile(run: () => Promise<void>): Promise<void> {
		armed++;
		try {
			await run();
		} finally {
			armed--;
		}
	}

	const awaiting = new Map<string, Cell>();

	host.approvals.onResolved((request, decision) => {
		const form = awaiting.get(request.id);
		if (form === undefined) return;
		awaiting.delete(request.id);
		host.approvals.consume(request.name);
		if (decision.approved) commit(form);
	});

	function askFor(
		interp: Interp,
		name: string,
		args: string,
		reason: string | undefined,
		report: string,
		change?: Cell,
	): never {
		const request: ApprovalRequest = {
			id: `${host.clock.now().toString(36)}-${(issued++).toString(36)}`,
			name,
			args,
			...(reason === undefined ? {} : { reason }),
			at: host.clock.now(),
			...(change === undefined ? {} : { change: true as const }),
		};
		host.approvals.open(request);
		if (change !== undefined) awaiting.set(request.id, change);
		requested.emit(interp.channels, { user: request });
		for (const approver of host.approvers) approver.ask?.(request);
		throw new StepHold(report);
	}

	function guard(interp: Interp, name: string, args: readonly unknown[]): void {
		if (armed === 0 || name.startsWith(OWN_FORMS)) return;
		const { verdict, reason } = rules.decide(name);
		if (verdict === "allow") return;
		if (verdict === "deny")
			throw new PermissionRefusal(
				name,
				`${name} is denied by the permissions config${reason === undefined ? "" : `: ${reason}`}. Do not call it again`,
			);
		if (host.approvals.granted(name)) {
			host.approvals.consume(name);
			return;
		}
		askFor(
			interp,
			name,
			summarize(args),
			reason,
			`${name} is waiting for the user's approval. The turn ends here; you will be told when they answer, and after an approval run it again exactly as before`,
		);
	}

	function apply(interp: Interp, given: unknown): unknown {
		const form = typeof given === "string" ? readOne(given) : given;
		if (!(form instanceof Cell))
			throw new EvalException("not a permissions form", given, false);
		const operation = form.car instanceof Sym ? form.car.name : str(form.car);
		changed(form);
		const change = str(form);
		const { verdict, reason } = rules.current.named(operation) ?? {
			verdict: "ask",
		};
		if (verdict === "deny")
			throw new PermissionRefusal(
				operation,
				`${operation} is denied by the permissions config${reason === undefined ? "" : `: ${reason}`}, so ${change} changes nothing. Do not run it again`,
			);
		if (verdict === "ask")
			askFor(
				interp,
				change,
				"",
				reason ?? "changes the permissions config",
				`${change} changes the permissions config and is waiting for the user's approval. The turn ends here; once they approve it is applied, so do not run it again`,
				form,
			);
		return commit(form);
	}

	function changed(form: Cell): PermissionRules {
		return form.car === DELETE_SYM
			? rules.current.without(deleted(form))
			: rules.current.with(form);
	}

	function commit(form: Cell): unknown {
		const next = changed(form);
		rules.replace(next);
		const saved = host.store.save(next.source);
		return saved instanceof Promise ? saved.then(() => form) : form;
	}

	return Object.assign(
		(interp: Interp): void => {
			registerPermissions(interp, rules, (form) => apply(interp, form));
			interp.hooks.call.use((i, name, args, next) => {
				guard(i, name, args);
				next(i, name, args);
			});
			interp.hooks.failedForm.use(function* (i, form, error, next) {
				if (error instanceof PermissionRefusal)
					return { reported: error.report };
				return yield* next(i, form, error);
			});
		},
		{
			rules,
			prompt: host.prompt(),
			session(hooks: SessionHooks): void {
				hooks.evalStep.use((ctx, next) => armedWhile(() => next(ctx)));
				hooks.invoke.use((ctx, next) => armedWhile(() => next(ctx)));
				for (const approver of host.approvers)
					approver.session?.(hooks, host.approvals);
			},
		},
	);
}

const FORM_DOCS: Record<(typeof RULE_FORMS)[number], [string, string]> = {
	"permission/default": [
		"(permission/default allow|deny|ask)",
		"Set what a call gets when no rule names it.",
	],
	"permission/allow": [
		'(permission/allow name... [:reason "..."])',
		"Allow calls to each name; a trailing * is a glob.",
	],
	"permission/deny": [
		'(permission/deny name... [:reason "..."])',
		"Deny calls to each name; a trailing * is a glob.",
	],
	"permission/ask": [
		'(permission/ask name... [:reason "..."])',
		"Make calls to each name wait for the user's approval.",
	],
	"permission/server": [
		"(permission/server server rule...)",
		"Rules for one MCP server's tools, by tool name: (allow ...) (deny ...) (ask ...) (hide ...) (only ...). only hides every tool it does not name.",
	],
	"permission/deny-server": [
		'(permission/deny-server server... [:reason "..."])',
		"Refuse to load each server; it stays discoverable.",
	],
	"permission/hide-server": [
		"(permission/hide-server server...)",
		"Hide each server: it cannot be loaded or found.",
	],
};

const APPLIES =
	" Waits for the user's approval, then is saved with the config; a rule naming this form, such as (permission/allow permission/deny), lets it apply at once instead.";

export function registerPermissions(
	interp: Interp,
	rules: SessionRules,
	apply: (form: unknown) => unknown,
): void {
	interp.def(
		"permission/apply",
		1,
		"(permission/apply 'form)",
		`Apply one permissions form, given as data.${APPLIES}`,
		z.tuple([zAny]),
		([form]) => apply(form),
	);
	const applying = interp.makeBuiltIn("permission/apply", 1, ([form]) =>
		apply(form),
	);
	interp.def(
		"permission/expand",
		2,
		"(permission/expand head forms)",
		"Build the call a permissions form expands to. The permission/ forms use it; call those instead.",
		z.tuple([zString, zList]),
		([head, forms]) =>
			new Cell(applying, new Cell(str(new Cell(newSym(head), forms)), null)),
	);
	for (const name of RULE_FORMS) {
		const expander = runSync(
			interp,
			`(macro (&rest forms) (permission/expand "${name}" forms))`,
		);
		const [signature, doc] = FORM_DOCS[name];
		interp.defineGlobal(newSym(name), expander, {
			signature,
			doc: doc + APPLIES,
		});
	}
	interp.defineGlobal(
		DELETE_SYM,
		runSync(
			interp,
			`(macro (&rest forms) (permission/expand "${DELETE_FORM}" forms))`,
		),
		{
			signature: "(permission/delete form)",
			doc: `Delete one form from the permissions config, written exactly as (permission/list) shows it, e.g. (permission/delete (permission/deny eval)).${APPLIES}`,
		},
	);
	interp.def(
		"permission/list",
		0,
		"(permission/list)",
		"Return the permissions config this session runs under, as its forms.",
		z.tuple([]),
		() => arrayToList([...rules.current.forms]),
	);
	interp.def(
		"permission/check",
		1,
		"(permission/check 'name)",
		"Return allow, deny or ask: what the permissions config decides for a call to `name`. An MCP tool is named server/tool.",
		z.tuple([zSym]),
		([sym]) => newSym(rules.decide(sym.name).verdict),
	);
}

function readOne(source: string): unknown {
	const reader = new Reader();
	reader.push(source);
	return reader.read();
}

function summarize(args: readonly unknown[]): string {
	const text = args.map((a) => str(a)).join(" ");
	return text.length <= MAX_ARGS_CHARS
		? text
		: `${text.slice(0, MAX_ARGS_CHARS)}…`;
}
