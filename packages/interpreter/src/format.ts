import { EvalException } from "./errors.ts";
import { Cell, type List } from "./objects.ts";
import { str } from "./print.ts";

interface Args {
	readonly items: readonly unknown[];
	next: number;
}

interface Run {
	readonly text: string;
	readonly escaped: boolean;
}

function take(control: string, args: Args): unknown {
	if (args.next >= args.items.length)
		throw new EvalException(
			"format: not enough arguments for the template",
			control,
		);
	const item = args.items[args.next];
	args.next += 1;
	return item;
}

function decimal(x: unknown): string {
	if (typeof x === "bigint") return x.toString();
	if (typeof x === "number" && Number.isInteger(x)) return String(x);
	return str(x, false);
}

function closing(control: string, open: number): number {
	let depth = 1;
	for (let i = open; i < control.length - 1; i++) {
		if (control[i] !== "~") continue;
		const directive = control[i + 1];
		if (directive === "{") depth += 1;
		if (directive === "}") depth -= 1;
		if (depth === 0) return i;
		i += 1;
	}
	throw new EvalException("format: a ~{ has no closing ~}", control);
}

function listed(value: unknown): unknown[] {
	if (value !== null && !(value instanceof Cell))
		throw new EvalException("format: ~{ takes a list", value);
	const items: unknown[] = [];
	for (let p: List = value; p !== null; p = p.cdr as List) items.push(p.car);
	return items;
}

const PLAIN: Readonly<Record<string, (args: Args, control: string) => string>> =
	{
		a: (args, control) => str(take(control, args), false),
		s: (args, control) => str(take(control, args)),
		d: (args, control) => decimal(take(control, args)),
		"%": () => "\n",
		"~": () => "~",
	};

function looped(body: string, value: unknown): string {
	const inner: Args = { items: listed(value), next: 0 };
	let text = "";
	while (inner.next < inner.items.length) {
		const before = inner.next;
		const pass = run(body, inner);
		text += pass.text;
		if (pass.escaped || inner.next === before) break;
	}
	return text;
}

function directiveAt(control: string, at: number): string {
	const directive = control[at + 1];
	if (directive === undefined)
		throw new EvalException("format: a ~ ends the template", control);
	return directive.toLowerCase();
}

function run(control: string, args: Args): Run {
	let text = "";
	for (let i = 0; i < control.length; i++) {
		if (control[i] !== "~") {
			text += control[i];
			continue;
		}
		const directive = directiveAt(control, i);
		i += 1;
		const plain = PLAIN[directive];
		if (plain !== undefined) text += plain(args, control);
		else if (directive === "&") text += freshLine(text);
		else if (directive === "^") {
			if (args.next >= args.items.length) return { text, escaped: true };
		} else if (directive === "{") {
			const end = closing(control, i + 1);
			text += looped(control.slice(i + 1, end), take(control, args));
			i = end + 1;
		} else
			throw new EvalException(
				`format: unknown directive ~${control[i] ?? ""}`,
				control,
			);
	}
	return { text, escaped: false };
}

function freshLine(text: string): string {
	return text !== "" && !text.endsWith("\n") ? "\n" : "";
}

export function formatText(control: string, items: readonly unknown[]): string {
	const args: Args = { items, next: 0 };
	return run(control, args).text;
}
