import { describe, expect, it } from "vitest";
import {
	DESKTOP_DOWNLOADS,
	primaryDownload,
} from "../src/lib/desktop-downloads.ts";

describe("desktop downloads", () => {
	it("puts the visitor's own os first", () => {
		expect(primaryDownload("macOS")?.url).toMatch(/salsal-arm64\.dmg$/);
		expect(primaryDownload("Windows")?.url).toMatch(/salsal-setup\.exe$/);
		expect(primaryDownload("Linux")?.url).toMatch(/salsal\.AppImage$/);
		expect(
			primaryDownload(
				"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
			)?.os,
		).toBe("windows");
	});

	it("offers no primary download on an os it does not ship for", () => {
		expect(primaryDownload("Android")).toBeUndefined();
	});

	it("points every download at the latest release", () => {
		for (const download of DESKTOP_DOWNLOADS)
			expect(download.url).toMatch(
				/^https:\/\/github\.com\/1hachem\/lisptc\/releases\/latest\/download\//,
			);
	});
});
