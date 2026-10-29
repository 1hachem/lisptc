import { describe, expect, it } from "vitest";
import { latestRelease } from "../../server/desktop/release.ts";

function world(answer: () => Promise<Response>) {
	let now = 0;
	let calls = 0;
	const release = latestRelease({
		fetch: () => {
			calls += 1;
			return answer();
		},
		now: () => now,
	});
	return {
		release,
		calls: () => calls,
		pass: (ms: number) => {
			now += ms;
		},
	};
}

const PUBLISHED = () =>
	Promise.resolve(
		Response.json({
			tag_name: "desktop-v1.2.3",
			published_at: "2026-10-01T00:00:00Z",
		}),
	);

describe("latest desktop release", () => {
	it("reads the tag and date, and keeps them for ten minutes", async () => {
		const { release, calls, pass } = world(PUBLISHED);
		expect(await release()).toEqual({
			tag: "desktop-v1.2.3",
			publishedAt: "2026-10-01T00:00:00Z",
		});
		pass(9 * 60_000);
		await release();
		expect(calls()).toBe(1);
		pass(2 * 60_000);
		await release();
		expect(calls()).toBe(2);
	});

	it("answers null when there is no release yet", async () => {
		const { release } = world(() =>
			Promise.resolve(new Response("{}", { status: 404 })),
		);
		expect(await release()).toBeNull();
	});

	it("answers null when github cannot be reached", async () => {
		const { release } = world(() => Promise.reject(new Error("offline")));
		expect(await release()).toBeNull();
	});
});
