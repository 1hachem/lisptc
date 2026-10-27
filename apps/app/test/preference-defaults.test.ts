import { DEFAULT_TOGGLES } from "@repo/backend/preference-defaults";
import { describe, expect, it } from "vitest";
import { INPUT_HELPERS } from "../src/lib/input-helpers.ts";
import { META_FIELDS } from "../src/lib/meta-fields.ts";

const ids = (fields: readonly { id: string }[]) =>
	fields.map(({ id }) => id).sort();

describe("the toggles the app offers", () => {
	it("are exactly the ones the backend gives a default", () => {
		expect(ids(META_FIELDS)).toEqual(
			Object.keys(DEFAULT_TOGGLES.metadata).sort(),
		);
		expect(ids(INPUT_HELPERS)).toEqual(
			Object.keys(DEFAULT_TOGGLES.input).sort(),
		);
	});
});
