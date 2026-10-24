// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DownloadButton } from "../src/components/stored-file.tsx";

const reported = vi.hoisted(() => vi.fn());

vi.mock("../src/lib/analytics.tsx", () => ({ reportIssue: reported }));

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
	const fetched = vi.fn(async () => response);
	vi.stubGlobal("fetch", fetched);
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
	const open = vi.spyOn(window, "open");

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
	return { host, fetched, blobs, opened, open, root };
}

describe("downloading a stored file", () => {
	it("saves it through a same-origin blob and never opens the storage url", async () => {
		const { host, fetched, blobs, opened, open, root } = await clicked(
			new Response("<script>alert(1)</script>", {
				headers: { "Content-Type": "text/html" },
			}),
		);

		expect(fetched).toHaveBeenCalledWith(STORAGE);
		expect(blobs).toHaveLength(1);
		expect(blobs[0]?.type).toBe("application/octet-stream");
		expect(opened).toEqual([{ href: "blob:app/1", download: "page.html" }]);
		expect(open).not.toHaveBeenCalled();
		expect(host.querySelector(`a[href="${STORAGE}"]`)).toBeNull();
		root.unmount();
	});

	it("shows the failure when storage refuses", async () => {
		vi.spyOn(console, "warn").mockImplementation(() => {});
		const { host, opened, root } = await clicked(
			new Response("gone", { status: 404 }),
		);

		expect(opened).toEqual([]);
		const button = host.querySelector("button");
		expect(button?.textContent).toBe("download failed");
		expect(button?.title).toBe("download answered 404");
		expect(reported).toHaveBeenCalled();
		root.unmount();
	});
});
