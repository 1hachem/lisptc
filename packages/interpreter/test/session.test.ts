import { describe, expect, it } from "vitest";
import {
	type InterpExtension,
	newSessionHooks,
	openSession,
	type SessionHooks,
	slot,
} from "../src/session.ts";

describe("a session's slots", () => {
	it("holds nothing until a slot is filled", () => {
		const hooks = newSessionHooks();
		expect(hooks.filled(slot<number>("count"))).toBeUndefined();
	});

	it("hands back what was filled under the slot's name", () => {
		const hooks = newSessionHooks();
		hooks.fill(slot<number>("count"), 3);
		expect(hooks.filled(slot<number>("count"))).toBe(3);
	});
});

describe("openSession", () => {
	it("starts every chain empty", () => {
		const hooks = openSession([]);
		expect(hooks.response.isEmpty).toBe(true);
		expect(hooks.response.run((_, text) => text, undefined as never, "x")).toBe(
			"x",
		);
	});

	it("lets each extension hook the chains, and skips one with no session", () => {
		const shouting: InterpExtension = Object.assign(() => {}, {
			session(hooks: SessionHooks) {
				hooks.response.use((interp, text, next) =>
					next(interp, text.toUpperCase()),
				);
			},
		});
		const silent: InterpExtension = () => {};
		const hooks = openSession([silent, shouting]);
		expect(
			hooks.response.run((_, text) => text, undefined as never, "quiet"),
		).toBe("QUIET");
	});
});
