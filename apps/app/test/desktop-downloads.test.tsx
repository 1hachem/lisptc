// @vitest-environment happy-dom
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, describe, expect, it, vi } from "vitest";

const visit = vi.hoisted(() => ({ search: {} as Record<string, unknown> }));

vi.mock("@tanstack/react-router", () => ({
	createFileRoute:
		() =>
		(options: {
			validateSearch: (search: Record<string, unknown>) => unknown;
			component: () => ReactNode;
		}) => ({
			options,
			useSearch: () => options.validateSearch(visit.search),
		}),
	Link: ({ children }: { children: ReactNode }) => <a href="/">{children}</a>,
}));

import {
	DESKTOP_DOWNLOADS,
	primaryDownload,
} from "../src/lib/desktop-downloads.ts";
import { Route } from "../src/routes/thanks.tsx";

beforeAll(() => {
	Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
});

function thanks(search: Record<string, unknown>, platform: string): string {
	visit.search = search;
	vi.spyOn(navigator, "userAgent", "get").mockReturnValue(platform);
	const Thanks = (
		Route as unknown as { options: { component: () => ReactNode } }
	).options.component;
	const host = document.createElement("div");
	act(() => createRoot(host).render(<Thanks />));
	vi.restoreAllMocks();
	return host.textContent ?? "";
}

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
		expect(thanks({ file: "mac-x64" }, "Windows")).toContain("salsal-x64.dmg");
		expect(thanks({}, "Linux")).toContain("salsal.AppImage for Linux");
		expect(thanks({ file: "salsal.exe" }, "Linux")).toContain(
			"salsal.AppImage for Linux",
		);
	});
});
