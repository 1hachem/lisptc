import { readFileSync } from "node:fs";
import { Interp, runAsync, runSync } from "@repo/interpreter/lisp";
import { prelude } from "@repo/interpreter/prelude";
import { str } from "@repo/interpreter/print";
import { describe, expect, it } from "vitest";
import { onboardingExtension } from "../src/onboarding.ts";
import { onboardingHostFor } from "../src/onboarding-host.ts";
import {
	type Onboarded,
	type Onboarding,
	type OnboardingStore,
	type Progress,
	VolatileOnboardingStore,
} from "../src/ports.ts";

class PromisedStore implements OnboardingStore {
	readonly inner = new VolatileOnboardingStore();

	async all(): Promise<Onboarded[]> {
		return this.inner.all();
	}

	async get(name: string): Promise<Onboarded | undefined> {
		return this.inner.get(name);
	}

	async put(onboarding: Onboarding): Promise<void> {
		this.inner.put(onboarding);
	}

	async mark(name: string, progress: Progress): Promise<void> {
		this.inner.mark(name, progress);
	}
}

function fresh(store: OnboardingStore = new VolatileOnboardingStore()) {
	const interp = new Interp({
		extensions: [onboardingExtension(onboardingHostFor(store))],
	});
	runSync(interp, prelude);
	return { interp, store };
}

async function ev(interp: Interp, code: string): Promise<string> {
	return str((await runAsync(interp, code)).value);
}

const WELCOME =
	'(onboarding/create "welcome" \'(setq shown "welcome") :about "first look")';

describe("onboarding scripts", () => {
	it("creates one and lists it as new", async () => {
		const { interp } = fresh();
		expect(await ev(interp, WELCOME)).toBe('"welcome"');
		expect(await ev(interp, "(onboardings)")).toBe(
			'(("welcome" "new" "first look"))',
		);
	});

	it("reads the script back as the form it runs", async () => {
		const { interp } = fresh();
		await ev(interp, WELCOME);
		expect(await ev(interp, '(onboarding/read "welcome")')).toBe(
			'(setq shown "welcome")',
		);
	});

	it("refuses a name that is taken", async () => {
		const { interp } = fresh();
		await ev(interp, WELCOME);
		await expect(ev(interp, WELCOME)).rejects.toThrow(/onboarding\/update/);
	});

	it("refuses a name that is not a slug", async () => {
		const { interp } = fresh();
		await expect(
			ev(interp, '(onboarding/create "First Chat" \'(+ 1 2))'),
		).rejects.toThrow(/lower-case/);
	});

	it("refuses a script that is not a form", async () => {
		const { interp } = fresh();
		await expect(
			ev(interp, '(onboarding/create "welcome" "say hi")'),
		).rejects.toThrow(/quoted form/);
	});

	it("updates the script and keeps the line and the status", async () => {
		const { interp } = fresh();
		await ev(interp, WELCOME);
		await ev(interp, '(onboarding/done "welcome")');
		await ev(interp, '(onboarding/update "welcome" \'(+ 1 2))');
		expect(await ev(interp, "(onboardings)")).toBe(
			'(("welcome" "done" "first look"))',
		);
		expect(await ev(interp, '(onboarding/run "welcome")')).toBe("3");
	});

	it("refuses to update one that does not exist", async () => {
		const { interp } = fresh();
		await expect(
			ev(interp, '(onboarding/update "welcome" \'(+ 1 2))'),
		).rejects.toThrow(/no onboarding/);
	});

	it("runs the script in the agent's interpreter and marks the user started", async () => {
		const { interp } = fresh();
		await ev(interp, WELCOME);
		expect(await ev(interp, '(onboarding/run "welcome")')).toBe('"welcome"');
		expect(await ev(interp, "shown")).toBe('"welcome"');
		expect(await ev(interp, "(car (cdr (car (onboardings))))")).toBe(
			'"started"',
		);
	});

	it("keeps a user done when they run it again", async () => {
		const { interp } = fresh();
		await ev(interp, WELCOME);
		await ev(interp, '(onboarding/done "welcome")');
		await ev(interp, '(onboarding/run "welcome")');
		expect(await ev(interp, '(onboarding/done? "welcome")')).toBe("t");
	});

	it("answers nil for a user who has not finished it", async () => {
		const { interp } = fresh();
		await ev(interp, WELCOME);
		await ev(interp, '(onboarding/run "welcome")');
		expect(await ev(interp, '(onboarding/done? "welcome")')).toBe("nil");
	});

	it("holds under a store that answers with promises", async () => {
		const { interp } = fresh(new PromisedStore());
		await ev(interp, WELCOME);
		await ev(interp, '(onboarding/run "welcome")');
		await ev(interp, '(onboarding/done "welcome")');
		expect(await ev(interp, "(onboardings)")).toBe(
			'(("welcome" "done" "first look"))',
		);
	});

	it("stores the example the prompt shows", async () => {
		const { interp, store } = fresh();
		const prompt = readFileSync(
			new URL("../src/onboarding.ptc", import.meta.url),
			"utf8",
		);
		const example = prompt.slice(
			prompt.indexOf('(onboarding/create "welcome"'),
			prompt.indexOf(':about "first look at app")') +
				':about "first look at app")'.length,
		);
		expect(await ev(interp, example)).toBe('"welcome"');
		expect(str((await store.get("welcome"))?.script)).toContain(
			'(ui/tour "welcome"',
		);
	});
});
