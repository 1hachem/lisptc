import { afterEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../convex/_generated/api.js";
import {
	seededVerticalOwner,
	verticalOwnerEmails,
} from "../convex/lib/vertical-owners.ts";
import { harness, signIn } from "./helpers.ts";

afterEach(() => {
	vi.unstubAllEnvs();
});

describe("the vertical owner seed list", () => {
	it("reads emails split by commas or whitespace, case-insensitively", () => {
		expect(
			verticalOwnerEmails(" Alice@Example.com, bob@example.com\ncarol@x.io "),
		).toEqual(["alice@example.com", "bob@example.com", "carol@x.io"]);
		expect(verticalOwnerEmails(undefined)).toEqual([]);
	});

	it("grants only an account whose email is verified", () => {
		const list = "alice@example.com";
		expect(
			seededVerticalOwner(
				{ email: "ALICE@example.com", emailVerified: true },
				list,
			),
		).toBe(true);
		expect(
			seededVerticalOwner(
				{ email: "alice@example.com", emailVerified: false },
				list,
			),
		).toBe(false);
		expect(
			seededVerticalOwner(
				{ email: "bob@example.com", emailVerified: true },
				list,
			),
		).toBe(false);
	});

	it("seeds an existing account that is on the list and leaves the rest alone", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		const bob = await signIn(t, "bob@example.com");
		vi.stubEnv("VERTICAL_OWNER_EMAILS", "alice@example.com");
		expect(await t.mutation(internal.users.seedVerticalOwners, {})).toEqual([
			"alice@example.com",
		]);
		expect((await alice.as.query(api.users.me, {})).verticalOwner).toBe(true);
		expect(
			(await bob.as.query(api.users.me, {})).verticalOwner,
		).toBeUndefined();
		expect(await t.mutation(internal.users.seedVerticalOwners, {})).toEqual([]);
	});
});
