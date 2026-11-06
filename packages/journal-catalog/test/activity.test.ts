import { type Entry, view } from "@repo/shared/journal";
import { describe, expect, test } from "vitest";
import { activityKind } from "../src/activity.ts";

const foldActivity = (entries: readonly Entry[]) => view(entries, activityKind);

let ids = 0;
const entry = (kind: string, value: unknown): Entry => ({
	id: `e${++ids}`,
	kind,
	value,
});

describe("activityOf", () => {
	const started = (id: string, label = id) => ({
		kind: "mcp",
		label,
		state: "started" as const,
		id,
	});
	const of = (...values: unknown[]) =>
		foldActivity(values.map((value) => entry("activity", value)));

	test("keeps each id once, in the order it first appeared", () => {
		expect(of(started("a"), started("b")).map((e) => e.id)).toEqual(["a", "b"]);
	});

	test("lets a later state of the same id replace its started in place", () => {
		expect(
			of(started("a"), started("b"), {
				...started("a"),
				state: "done",
				detail: "d",
			}),
		).toEqual([
			{ kind: "mcp", label: "a", state: "done", detail: "d", id: "a" },
			started("b"),
		]);
	});

	test("keeps the start time of a started entry when its end carries only the duration", () => {
		expect(
			of(
				{ ...started("a"), startedAt: 1000 },
				{ ...started("a"), state: "failed", ms: 40 },
			),
		).toEqual([{ ...started("a"), state: "failed", startedAt: 1000, ms: 40 }]);
	});

	test("times a call from when it started to when it last ended, through a hold", () => {
		const stamp = activityKind.stamp;
		if (stamp === undefined) throw new Error("activity is stamped");
		expect(
			of(
				stamp(started("a"), 1000),
				stamp({ ...started("a"), state: "held" }, 1200),
				stamp({ ...started("a"), state: "done" }, 1500),
			),
		).toEqual([
			{
				...started("a"),
				state: "done",
				startedAt: 1000,
				endedAt: 1500,
				ms: 500,
			},
		]);
	});

	test("skips a malformed entry and an entry of another kind", () => {
		expect(
			foldActivity([
				entry("activity", { ...started("a"), state: "x" }),
				entry("memory", started("b")),
			]),
		).toEqual([]);
		expect(view([entry("activity", started("a"))], activityKind)).toEqual([
			started("a"),
		]);
	});
});
