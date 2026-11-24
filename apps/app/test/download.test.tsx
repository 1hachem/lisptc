// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DownloadButton } from "../src/components/stored-file.tsx";

vi.mock("../src/lib/analytics.tsx", () => ({ reportIssue: () => {} }));

const STORAGE = "https://deployment.test/api/storage/abc";

beforeAll(() => {
	(
		globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
	).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

async function clicked(response: Response) {
	vi.stubGlobal("fetch", async () => response);
	const blobs: Blob[] = [];
	vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
		blobs.push(blob as Blob);
		return "blob:app/1";
	});
	vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
	const opened: { href: string; download: string }[] = [];
	vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
		this: HTMLAnchorElement,
	) {
		opened.push({ href: this.href, download: this.download });
	});

	const host = document.createElement("div");
	const root = createRoot(host);
	await act(async () => {
		root.render(<DownloadButton name="page.html" url={STORAGE} />);
	});
	await act(async () => {
		host.querySelector("button")?.click();
	});
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
	return { host, blobs, opened, root };
}

describe("downloading a stored file", () => {
	it("saves an html file under its name as plain bytes, never rendering it", async () => {
		const { blobs, opened, root } = await clicked(
			new Response("<script>alert(1)</script>", {
				headers: { "Content-Type": "text/html" },
			}),
		);

		expect(opened.map((saved) => saved.download)).toEqual(["page.html"]);
		expect(blobs[0]?.type).toBe("application/octet-stream");
		expect(await blobs[0]?.text()).toBe("<script>alert(1)</script>");
		root.unmount();
	});

	it("saves nothing and says the download failed when storage refuses", async () => {
		vi.spyOn(console, "warn").mockImplementation(() => {});
		const { host, opened, root } = await clicked(
			new Response("gone", { status: 404 }),
		);

		expect(opened).toEqual([]);
		expect(host.textContent).toContain("download failed");
		root.unmount();
	});
});
