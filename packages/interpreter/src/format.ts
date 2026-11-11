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

function run(control: string, args: Args): Run {
	let text = "";
	for (let i = 0; i < control.length; i++) {
		const char = control[i];
		if (char !== "~") {
			text += char;
			continue;
		}
		if (i + 1 >= control.length)
			throw new EvalException("format: a ~ ends the template", control);
		const directive = control[i + 1]?.toLowerCase();
		i += 1;
		switch (directive) {
			case "a":
				text += str(take(control, args), false);
				break;
			case "s":
				text += str(take(control, args));
				break;
			case "d":
				text += decimal(take(control, args));
				break;
			case "%":
				text += "\n";
				break;
			case "&":
				if (text !== "" && !text.endsWith("\n")) text += "\n";
				break;
			case "~":
				text += "~";
				break;
			case "^":
				if (args.next >= args.items.length) return { text, escaped: true };
				break;
			case "{": {
				const end = closing(control, i + 1);
				const body = control.slice(i + 1, end);
				const inner: Args = {
					items: listed(take(control, args)),
					next: 0,
				};
				while (inner.next < inner.items.length) {
					const before = inner.next;
					const pass = run(body, inner);
					text += pass.text;
					if (pass.escaped || inner.next === before) break;
				}
				i = end + 1;
				break;
			}
			default:
				throw new EvalException(
					`format: unknown directive ~${control[i] ?? ""}`,
					control,
				);
		}
	}
	return { text, escaped: false };
}

export function formatText(control: string, items: readonly unknown[]): string {
	const args: Args = { items, next: 0 };
	return run(control, args).text;
}
