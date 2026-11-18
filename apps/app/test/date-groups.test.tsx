// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { DatedListing } from "../src/components/tree-listing.tsx";
import { dateGroupOf } from "../src/lib/date-groups.ts";

beforeAll(() => {
	Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
});

const now = new Date(2026, 9, 20, 9, 30).getTime();
const daysAgo = (days: number, hour = 12) =>
	new Date(2026, 9, 20 - days, hour).getTime();

describe("dateGroupOf", () => {
	it("goes by calendar day, not by hours since", () => {
		expect(dateGroupOf(new Date(2026, 9, 20, 0, 5).getTime(), now)).toBe(
			"today",
		);
		expect(dateGroupOf(daysAgo(1, 23), now)).toBe("yesterday");
	});

	it("reaches back a week, then a month, then older", () => {
		expect(dateGroupOf(daysAgo(2), now)).toBe("last week");
		expect(dateGroupOf(daysAgo(7), now)).toBe("last week");
		expect(dateGroupOf(daysAgo(8), now)).toBe("last month");
		expect(dateGroupOf(daysAgo(30), now)).toBe("last month");
		expect(dateGroupOf(daysAgo(31), now)).toBe("older");
	});
});

describe("a dated listing", () => {
	it("groups newest first and leaves out the empty groups", () => {
		vi.setSystemTime(now);
		const files = [
			{ name: "old.md", at: daysAgo(40) },
			{ name: "a.md", at: daysAgo(0, 8) },
			{ name: "b.md", at: daysAgo(0, 9) },
			{ name: "c.md", at: daysAgo(3) },
		];
		const host = document.createElement("div");
		act(() =>
			createRoot(host).render(
				<DatedListing
					items={files}
					at={(file) => file.at}
					empty={null}
					check={() => ({
						checked: false,
						selecting: false,
						onCheck: () => {},
					})}
				>
					{(file) => <p key={file.name}>{file.name}</p>}
				</DatedListing>,
			),
		);
		vi.useRealTimers();
		expect(host.textContent).toBe("todayb.mda.mdlast weekc.mdolderold.md");
	});
});
