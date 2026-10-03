import { describe, expect, test } from "vitest";
import { SteerInbox } from "../src/inbox.ts";

const steer = { id: "s1", content: "use hex" };

describe("the steer inbox", () => {
	test("a post with no open turn is refused", () => {
		const inbox = new SteerInbox();

		expect(inbox.post("t", steer)).toBe(false);
		inbox.open("t");
		inbox.close("t");
		expect(inbox.post("t", steer)).toBe(false);
	});

	test("take hands over what was posted, once", () => {
		const inbox = new SteerInbox();
		inbox.open("t");

		expect(inbox.post("t", steer)).toBe(true);
		expect(inbox.take("t")).toEqual([steer]);
		expect(inbox.take("t")).toEqual([]);
	});

	test("a withdrawn steer is never taken, and one already taken cannot be withdrawn", () => {
		const inbox = new SteerInbox();
		inbox.open("t");
		inbox.post("t", steer);
		inbox.post("t", { id: "s2", content: "stop" });

		expect(inbox.withdraw("t", "s1")).toBe(true);
		expect(inbox.take("t")).toEqual([{ id: "s2", content: "stop" }]);
		expect(inbox.withdraw("t", "s2")).toBe(false);
	});

	test("closing drops what was never taken", () => {
		const inbox = new SteerInbox();
		inbox.open("t");
		inbox.post("t", steer);
		inbox.close("t");

		expect(inbox.take("t")).toEqual([]);
	});
});
