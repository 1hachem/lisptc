import { bufferTransport } from "@repo/interpreter/channels-host";
import { Interp, runAsync } from "@repo/interpreter/lisp";
import { prelude } from "@repo/interpreter/prelude";
import { zString } from "@repo/interpreter/schema";
import { note } from "@repo/interpreter/topics";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { promisesExtension } from "../src/promises.ts";
import { promisesHost } from "../src/promises-host.ts";

function interpWithJob(): Interp {
	const interp = new Interp({ extensions: [promisesExtension(promisesHost)] });
	runAsync(interp, prelude);
	interp.defPromise(
		"job",
		0,
		"(job)",
		"Return a job that settles to a string.",
		z.tuple([]),
		() => Promise.resolve("done"),
	);
	interp.def(
		"shout",
		1,
		"(shout s)",
		"Return the string in upper case.",
		z.tuple([zString]),
		([s]) => s.toUpperCase(),
	);
	return interp;
}

async function failureOf(code: string): Promise<string> {
	const interp = interpWithJob();
	const buffer = bufferTransport();
	const detach = interp.channels.pipe(buffer);
	try {
		await runAsync(interp, code);
	} catch {
	} finally {
		detach();
	}
	return buffer
		.collect(note)
		.filter((n) => n.kind === "failed")
		.map((n) => n.text)
		.join("");
}

describe("a job used where its value was expected says so", () => {
	it("names the argument and the call, and points at await", async () => {
		const text = await failureOf("(shout (job))");
		expect(text).toContain("argument 1 of shout is a job, not its value");
		expect(text).toContain("(await ...)");
	});

	it("keeps the original failure above the advice", async () => {
		const text = await failureOf("(shout (job))");
		expect(text).toContain("string expected");
	});

	it("says nothing about await when the argument is not a job", async () => {
		const text = await failureOf("(shout 5)");
		expect(text).toContain("string expected");
		expect(text).not.toContain("await");
	});

	it("says nothing when the call succeeds on an awaited job", async () => {
		const text = await failureOf("(shout (await (job)))");
		expect(text).toBe("");
	});
});
