import { describe, expect, it } from "vitest";
import {
	chosenDownload,
	DESKTOP_DOWNLOADS,
	isDownloadId,
	primaryDownload,
	startDownload,
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

	it("thanks page takes the installer it was asked for, else the visitor's own", () => {
		expect(chosenDownload("mac-x64", "Windows")?.file).toBe("salsal-x64.dmg");
		expect(chosenDownload(undefined, "Linux")?.file).toBe("salsal.AppImage");
		expect(isDownloadId("windows")).toBe(true);
		expect(isDownloadId("salsal.exe")).toBe(false);
	});

	it("starts a download in a hidden frame without leaving the page", () => {
		const appended: { hidden: boolean; src: string }[] = [];
		const doc = {
			createElement: () => ({ hidden: false, src: "" }),
			body: {
				append: (frame: { hidden: boolean; src: string }) =>
					appended.push(frame),
			},
		} as unknown as Document;
		const linux = DESKTOP_DOWNLOADS.find((download) => download.id === "linux");
		startDownload(linux?.url ?? "", doc);
		expect(appended).toEqual([{ hidden: true, src: linux?.url }]);
	});
});
