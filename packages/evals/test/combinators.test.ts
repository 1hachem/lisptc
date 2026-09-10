import { Interp, prelude, runSync } from "@repo/interpreter/lisp";
import { describe, expect, test } from "vitest";
import { Checks } from "../src/checks.ts";
import type { CheckOutcome } from "../src/report.ts";
import { Trace } from "../src/trace.ts";

const reader = new Interp();
runSync(reader, prelude);

function form(source: string): unknown {
	return runSync(reader, `'${source}`);
}

class Fixture {
	readonly trace = new Trace();
	private step = 0;
	private checks?: Checks;

	wrote(source: string): this {
		this.trace.add(
			{ kind: "form", step: this.step, form: source, value: "nil" },
			form(source),
		);
		return this;
	}

	connected(server: string, ok = true): this {
		this.trace.add({ kind: "connect", step: this.step, server, ok });
		return this;
	}

	tooled(
		server: string,
		tool: string,
		args: Record<string, unknown> = {},
	): this {
		this.trace.add({
			kind: "tool",
			step: this.step,
			server,
			tool,
			args,
			ok: true,
		});
		return this;
	}

	stopped(): this {
		this.trace.add({ kind: "halt", step: this.step });
		return this;
	}

	watch(source: string): this {
		this.checks = new Checks(this.trace, source);
		return this;
	}

	tick(): this {
		this.step += 1;
		this.trace.beginStep(this.step);
		return this;
	}

	settle(): this {
		this.checks?.evaluate(this.step);
		return this;
	}

	get results(): CheckOutcome[] {
		return this.checks?.results() ?? [];
	}

	verdict(name: string): string {
		return this.results.find((r) => r.name === name)?.verdict ?? "missing";
	}

	decidedAt(name: string): number | undefined {
		return this.results.find((r) => r.name === name)?.step;
	}
}

describe("liveness combinators end false when nothing happened", () => {
	test("eventually", () => {
		const f = new Fixture()
			.watch("(defcheck it (eventually (halted)))")
			.tick()
			.settle();
		expect(f.verdict("it")).toBe("false");
	});

	test("before, when the thing it waits on never happens", () => {
		const f = new Fixture()
			.watch(
				'(defcheck it (before (called "load-mcp") (called "search-mcps")))',
			)
			.tick()
			.settle();
		expect(f.verdict("it")).toBe("false");
	});
});

describe("safety combinators end true when nothing happened", () => {
	test("never is not falsified by a clean run", () => {
		const f = new Fixture()
			.watch('(defcheck it (never (called-server-other-than "playwright")))')
			.tick()
			.settle()
			.tick()
			.settle();
		expect(f.verdict("it")).toBe("true");
	});

	test("always holds when every step matched", () => {
		const f = new Fixture().watch('(defcheck it (always (called "echo")))');
		f.tick().wrote("(echo 1)").settle();
		f.tick().wrote("(echo 2)").settle();
		expect(f.verdict("it")).toBe("true");
	});

	test("always fails on the first bare step", () => {
		const f = new Fixture().watch('(defcheck it (always (called "echo")))');
		f.tick().wrote("(echo 1)").settle();
		f.tick().wrote("(car lst)").settle();
		expect(f.verdict("it")).toBe("false");
		expect(f.decidedAt("it")).toBe(2);
	});
});

describe("before reads as: before a happens, b should happen", () => {
	const source =
		'(defcheck finds-the-server (before (called "load-mcp") (called-any "search-mcps" "list-toolkit")))';

	test("searching first satisfies it", () => {
		const f = new Fixture().watch(source);
		f.tick().wrote('(search-mcps "browser")').settle();
		f.tick().wrote('(load-mcp "playwright")').connected("playwright").settle();
		expect(f.verdict("finds-the-server")).toBe("true");
		expect(f.decidedAt("finds-the-server")).toBe(2);
	});

	test("loading blind fails it", () => {
		const f = new Fixture().watch(source);
		f.tick().wrote('(load-mcp "playwright")').connected("playwright").settle();
		expect(f.verdict("finds-the-server")).toBe("false");
		expect(f.decidedAt("finds-the-server")).toBe(1);
	});
});

describe("a decision latches", () => {
	test("a later contradicting event cannot undo it", () => {
		const f = new Fixture().watch(
			'(defcheck it (before (called "load-mcp") (called "search-mcps")))',
		);
		f.tick().wrote('(search-mcps "browser")').settle();
		f.tick().wrote('(load-mcp "playwright")').settle();
		expect(f.verdict("it")).toBe("true");

		f.tick().wrote('(load-mcp "linear")').settle();
		expect(f.verdict("it")).toBe("true");
		expect(f.decidedAt("it")).toBe(2);
	});
});

describe("within latches false from the clock alone", () => {
	const source = "(defcheck stops (within 2 (halted)))";

	test("halting in time", () => {
		const f = new Fixture().watch(source);
		f.tick().stopped().settle();
		expect(f.verdict("stops")).toBe("true");
	});

	test("running past the budget", () => {
		const f = new Fixture().watch(source);
		f.tick().settle();
		f.tick().settle();
		f.tick().settle();
		expect(f.verdict("stops")).toBe("false");
		expect(f.decidedAt("stops")).toBe(3);
	});
});

describe("matchers", () => {
	test("a keyword argument is matched by pattern", () => {
		const f = new Fixture().watch(
			'(defcheck it (eventually (called "playwright/browser_navigate" :url (matches "hyko\\\\.ai"))))',
		);
		f.tick()
			.tooled("playwright", "browser_navigate", {
				url: "https://hyko.ai/pricing",
			})
			.settle();
		expect(f.verdict("it")).toBe("true");
	});

	test("a wrong argument does not match", () => {
		const f = new Fixture().watch(
			'(defcheck it (eventually (called "playwright/browser_navigate" :url (contains "example.com"))))',
		);
		f.tick()
			.tooled("playwright", "browser_navigate", { url: "https://hyko.ai" })
			.settle();
		expect(f.verdict("it")).toBe("false");
	});

	test("load-mcp is matched by the server it connected", () => {
		const f = new Fixture().watch(
			'(defcheck it (eventually (called "load-mcp" "playwright")))',
		);
		f.tick().connected("playwright").settle();
		expect(f.verdict("it")).toBe("true");
	});

	test("awaited reads the code the agent wrote", () => {
		const f = new Fixture().watch(
			'(defcheck it (eventually (awaited "load-mcp")))',
		);
		f.tick().wrote('(load-mcp "playwright")').settle();
		expect(f.verdict("it")).toBe("false");

		f.tick().wrote('(await (load-mcp "playwright"))').settle();
		expect(f.verdict("it")).toBe("true");
	});

	test("awaited follows the name the REPL minted for the promise", () => {
		const f = new Fixture().watch(
			'(defcheck it (eventually (awaited "load-mcp")))',
		);
		f.tick().wrote('(load-mcp "playwright")').settle();
		f.tick().wrote("(await load-mcp-1)").settle();
		expect(f.verdict("it")).toBe("true");
	});
});

describe("counting", () => {
	test("once is satisfied by exactly one", () => {
		const f = new Fixture().watch(
			'(defcheck it (once (called-server "playwright")))',
		);
		f.tick().tooled("playwright", "browser_navigate").settle();
		expect(f.verdict("it")).toBe("true");
	});

	test("once is falsified by a second", () => {
		const f = new Fixture().watch(
			'(defcheck it (once (called-server "playwright")))',
		);
		f.tick().tooled("playwright", "browser_navigate").settle();
		f.tick().tooled("playwright", "browser_click").settle();
		expect(f.verdict("it")).toBe("false");
	});
});

describe("requires is before without the demand that a ever happens", () => {
	const source =
		'(defcheck it (requires (called "playwright/browser_click") (called "playwright/browser_navigate")))';

	test("vacuously true when the thing it guards never happens", () => {
		const f = new Fixture().watch(source);
		f.tick().tooled("playwright", "browser_navigate").settle();
		expect(f.verdict("it")).toBe("true");
	});

	test("true when the guard is satisfied", () => {
		const f = new Fixture().watch(source);
		f.tick().tooled("playwright", "browser_navigate").settle();
		f.tick().tooled("playwright", "browser_click").settle();
		expect(f.verdict("it")).toBe("true");
	});

	test("false when the guarded thing comes first", () => {
		const f = new Fixture().watch(source);
		f.tick().tooled("playwright", "browser_click").settle();
		expect(f.verdict("it")).toBe("false");
		expect(f.decidedAt("it")).toBe(1);
	});
});

describe("without narrows a matcher by another", () => {
	const source =
		'(defcheck it (requires (without (called-server "playwright") (called "playwright/browser_navigate")) (called "playwright/browser_navigate")))';

	test("navigating first, then clicking, is fine", () => {
		const f = new Fixture().watch(source);
		f.tick().tooled("playwright", "browser_navigate").settle();
		f.tick().tooled("playwright", "browser_click").settle();
		expect(f.verdict("it")).toBe("true");
	});

	test("reaching for another tool before navigating is not", () => {
		const f = new Fixture().watch(source);
		f.tick().tooled("playwright", "browser_snapshot").settle();
		expect(f.verdict("it")).toBe("false");
	});

	test("navigating and nothing else leaves it true", () => {
		const f = new Fixture().watch(source);
		f.tick().tooled("playwright", "browser_navigate").settle();
		expect(f.verdict("it")).toBe("true");
	});
});

describe("called-any is how a check names more than one way to do a thing", () => {
	const source =
		'(defcheck it (before (called "playwright/browser_navigate") (called-any "list-tools" "search-tools")))';

	test("either discovery built-in satisfies it", () => {
		for (const how of ["list-tools", "search-tools"]) {
			const f = new Fixture().watch(source);
			f.tick().wrote(`(${how} "playwright")`).settle();
			f.tick().tooled("playwright", "browser_navigate").settle();
			expect(f.verdict("it")).toBe("true");
		}
	});

	test("neither of them still fails it", () => {
		const f = new Fixture().watch(source);
		f.tick().tooled("playwright", "browser_navigate").settle();
		expect(f.verdict("it")).toBe("false");
	});
});

describe("the DSL refuses nonsense rather than answering it", () => {
	test("a combinator fed another combinator's verdict", () => {
		const f = new Fixture().watch(
			'(defcheck it (never (happens (called "load-mcp") 4)))',
		);
		expect(() => f.tick().settle()).toThrow("expected a matcher");
	});

	test("a check whose body is a matcher, not a combinator", () => {
		const f = new Fixture().watch('(defcheck it (called "load-mcp"))');
		expect(() => f.tick().settle()).toThrow(
			"a check's body must be a combinator",
		);
	});
});
