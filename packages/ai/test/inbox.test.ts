import { describe, expect, test } from "vitest";
import { MemorySteerInbox } from "../src/inbox.ts";

const steer = { id: "s1", content: "use hex" };

describe("the in-memory steer inbox", () => {
	test("a post with no open turn is refused", async () => {
		const inbox = new MemorySteerInbox();
		expect(await inbox.post("t", steer)).toBe(false);
		await inbox.open("t");
		await inbox.close("t");
		expect(await inbox.post("t", steer)).toBe(false);
	});

	test("take hands over what was posted, once", async () => {
		const inbox = new MemorySteerInbox();
		await inbox.open("t");
		expect(await inbox.post("t", steer)).toBe(true);
		expect(await inbox.take("t")).toEqual([steer]);
		expect(await inbox.take("t")).toEqual([]);
	});

	test("a withdrawn steer is never taken, and one already taken cannot be withdrawn", async () => {
		const inbox = new MemorySteerInbox();
		await inbox.open("t");
		await inbox.post("t", steer);
		await inbox.post("t", { id: "s2", content: "stop" });
		expect(await inbox.withdraw("t", "s1")).toBe(true);
		expect(await inbox.take("t")).toEqual([{ id: "s2", content: "stop" }]);
		expect(await inbox.withdraw("t", "s2")).toBe(false);
	});

	test("closing drops what was never taken", async () => {
		const inbox = new MemorySteerInbox();
		await inbox.open("t");
		await inbox.post("t", steer);
		await inbox.close("t");
		expect(await inbox.take("t")).toEqual([]);
	});
});
