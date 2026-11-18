import { restore, snapshot } from "@repo/interpreter/image";
import { boot, Interp, runAsync, runSync } from "@repo/interpreter/lisp";
import { str } from "@repo/interpreter/print";
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
		boot(interp);
		runSync(
			interp,
			"(setq all (promise-all (list (wait-for 1) (wait-for 2))))",
		);
		const image = JSON.parse(JSON.stringify(snapshot(interp)));
		const back = interpWith(async (x) => x);
		restore(back, image);
		expect(str(runSync(back, "(promise-state all)"))).toBe(":pending");
		expect(str((await runAsync(back, "(await all)")).value)).toBe("(1 2)");
	});
});
