import { describe, expect, it } from "vitest";
import { latestRelease } from "../../server/desktop/release.ts";

function world(answer: () => Promise<Response>) {
	let now = 0;
	const release = latestRelease({ fetch: answer, now: () => now });
	return {
		release,
		pass: (ms: number) => {
			now += ms;
		},
	};
}

const published = (tag: string) =>
	Promise.resolve(
		Response.json({ tag_name: tag, published_at: "2026-10-01T00:00:00Z" }),
	);

describe("latest desktop release", () => {
	it("reads the tag and date, and keeps them for ten minutes", async () => {
		let tag = "desktop-v1.2.3";
		const { release, pass } = world(() => published(tag));
		expect(await release()).toEqual({
			tag: "desktop-v1.2.3",
			publishedAt: "2026-10-01T00:00:00Z",
		});
		tag = "desktop-v1.2.4";
		pass(9 * 60_000);
		expect((await release())?.tag).toBe("desktop-v1.2.3");
		pass(2 * 60_000);
		expect((await release())?.tag).toBe("desktop-v1.2.4");
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
