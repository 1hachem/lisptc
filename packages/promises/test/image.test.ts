import { restore, snapshot } from "@repo/interpreter/image";
import { Interp, runSync } from "@repo/interpreter/lisp";
import { newSym } from "@repo/interpreter/objects";
import { prelude } from "@repo/interpreter/prelude";
import { str } from "@repo/interpreter/print";
import type { LispPromise } from "@repo/interpreter/promise";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { promisesExtension } from "../src/promises.ts";
import { promisesHost } from "../src/promises-host.ts";

function interpWith(body: (x: unknown) => Promise<unknown>): Interp {
	const interp = new Interp({ extensions: [promisesExtension(promisesHost)] });
	interp.defResumable(
		"wait-for",
		1,
		"(wait-for x)",
		"Return x once the host lets it through.",
		z.tuple([z.unknown()]),
		([x]) => body(x),
	);
	return interp;
}

describe("a combinator in an image", () => {
	it("resumes a promise-all saved over a pending resumable child", async () => {
		const interp = interpWith(() => new Promise(() => {}));
		runSync(interp, prelude);
		runSync(
			interp,
			"(setq all (promise-all (list (wait-for 1) (wait-for 2))))",
		);
		const image = JSON.parse(JSON.stringify(snapshot(interp)));
		const back = interpWith(async (x) => x);
		restore(back, image);
		const all = back.getGlobal(newSym("all")) as LispPromise;
		expect(all.state).toBe("pending");
		expect(str(await all)).toBe("(1 2)");
		expect(all.state).toBe("fulfilled");
	});
});
