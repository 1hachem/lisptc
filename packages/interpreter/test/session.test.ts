import { describe, expect, it } from "vitest";
import {
	type InterpExtension,
	openSession,
	type SessionHooks,
} from "../src/session.ts";

describe("openSession", () => {
	it("starts every chain empty", () => {
		const hooks = openSession([]);
		expect(hooks.answer.isEmpty).toBe(true);
		expect(hooks.answer.run((_, text) => text, undefined as never, "x")).toBe(
			"x",
		);
	});

	it("lets each extension hook the chains, and skips one with no session", () => {
		const shouting: InterpExtension = Object.assign(() => {}, {
			session(hooks: SessionHooks) {
				hooks.answer.use((interp, text, next) =>
					next(interp, text.toUpperCase()),
				);
			},
		});
		const silent: InterpExtension = () => {};
		const hooks = openSession([silent, shouting]);
		expect(
			hooks.answer.run((_, text) => text, undefined as never, "quiet"),
		).toBe("QUIET");
	});
});
