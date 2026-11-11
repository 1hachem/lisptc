import { type Eval, settled } from "@repo/interpreter/drive";
import { EvalException } from "@repo/interpreter/errors";
import type { Interp } from "@repo/interpreter/lisp";
import {
	arrayToList,
	Cell,
	type List,
	listToArray,
} from "@repo/interpreter/objects";
import { plistOptions, splitKeywordArgs } from "@repo/interpreter/plist";
import { str } from "@repo/interpreter/print";
import { zList, zString } from "@repo/interpreter/schema";
import type { InterpExtension } from "@repo/interpreter/session";
import { z } from "zod";
import type { Onboarded, OnboardingHost, OnboardingStore } from "./ports.ts";

const NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const MAX_ABOUT_CHARS = 200;

function nameOf(x: unknown): string {
	if (typeof x !== "string" || !NAME.test(x))
		throw new EvalException(
			'an onboarding name is lower-case words joined by dashes, like "first-chat"',
			x,
		);
	return x;
}

function scriptOf(x: unknown): unknown {
	if (!(x instanceof Cell))
		throw new EvalException(
			"an onboarding script is a quoted form to run later, like '(ui/tour ...)",
			x,
		);
	const printed = str(x);
	if (printed.includes("#<") || printed.includes("#:"))
		throw new EvalException(
			"an onboarding script must read back; this one holds a live value",
			x,
		);
	return x;
}

function aboutOf(x: unknown): string | undefined {
	if (x === undefined) return undefined;
	if (typeof x !== "string" || x.length > MAX_ABOUT_CHARS)
		throw new EvalException(
			`:about is a string of at most ${MAX_ABOUT_CHARS} characters`,
			x,
		);
	return x;
}

const SCRIPT_ARGS = [
	{
		name: "about",
		type: "string",
		required: false,
		description: "one line on what the onboarding shows the user",
	},
];

function* existing(store: OnboardingStore, name: string): Eval<Onboarded> {
	const found = yield* settled(store.get(name));
	if (found === undefined)
		throw new EvalException("no onboarding by that name", name, false);
	return found;
}

function scriptArgs(rest: List): {
	name: string;
	script: unknown;
	about: string | undefined;
} {
	const { values, options } = splitKeywordArgs(rest, ["about"]);
	const [name, script] = listToArray(values);
	return {
		name: nameOf(name),
		script: scriptOf(script),
		about: aboutOf(plistOptions(options, ["about"]).get("about")),
	};
}

export function registerOnboarding(
	interp: Interp,
	store: OnboardingStore,
): void {
	interp.defGen(
		"onboardings",
		0,
		"(onboardings)",
		"List every onboarding this workspace keeps as (name status about), where status is new, started or done for this user.",
		z.tuple([]),
		function* (): Eval {
			const all = yield* settled(store.all());
			return arrayToList(
				all.map((o) => arrayToList([o.name, o.status, o.about])),
			);
		},
	);

	interp.defGen(
		"onboarding/read",
		1,
		"(onboarding/read name)",
		"The script of an onboarding, as the form it runs. Read it before you update it.",
		z.tuple([zString]),
		function* ([name]): Eval {
			return (yield* existing(store, name)).script;
		},
	);

	interp.defGen(
		"onboarding/create",
		-1,
		"(onboarding/create name 'script [:about text])",
		"Save a new onboarding: a quoted form, usually a (ui/tour ...), that walks the user through part of the app when run. Fails if the name is taken. Returns the name.",
		z.tuple([zList]),
		function* ([rest]): Eval {
			const { name, script, about } = scriptArgs(rest);
			if ((yield* settled(store.get(name))) !== undefined)
				throw new EvalException(
					"an onboarding by that name exists; change it with onboarding/update",
					name,
					false,
				);
			yield* settled(store.put({ name, script, about: about ?? "" }));
			return name;
		},
		SCRIPT_ARGS,
	);

	interp.defGen(
		"onboarding/update",
		-1,
		"(onboarding/update name 'script [:about text])",
		"Replace the script of an onboarding that exists, and its line with :about. Who has been through it stays as it was. Returns the name.",
		z.tuple([zList]),
		function* ([rest]): Eval {
			const { name, script, about } = scriptArgs(rest);
			const found = yield* existing(store, name);
			yield* settled(store.put({ name, script, about: about ?? found.about }));
			return name;
		},
		SCRIPT_ARGS,
	);

	interp.defGen(
		"onboarding/run",
		1,
		"(onboarding/run name)",
		"Evaluate an onboarding's script and return what it produced. A user who had not been through it is marked started.",
		z.tuple([zString]),
		function* ([name]): Eval {
			const found = yield* existing(store, name);
			if (found.status === "new") yield* settled(store.mark(name, "started"));
			return yield* interp.evalGen(found.script, null);
		},
	);

	interp.defGen(
		"onboarding/done",
		1,
		"(onboarding/done name)",
		"Mark this user as onboarded for `name`, in every chat. Returns the name.",
		z.tuple([zString]),
		function* ([name]): Eval {
			yield* existing(store, name);
			yield* settled(store.mark(name, "done"));
			return name;
		},
	);

	interp.defGen(
		"onboarding/done?",
		1,
		"(onboarding/done? name)",
		"t if this user has been through the onboarding `name`, nil if not.",
		z.tuple([zString]),
		function* ([name]): Eval {
			return (yield* existing(store, name)).status === "done" || null;
		},
	);
}

export function onboardingExtension(host: OnboardingHost): InterpExtension {
	return Object.assign(
		(interp: Interp): void => registerOnboarding(interp, host.store),
		{ prompt: host.prompt() },
	);
}
