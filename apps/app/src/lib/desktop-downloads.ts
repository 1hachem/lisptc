const LATEST = "https://github.com/1hachem/lisptc/releases/latest/download";

export type DesktopOs = "mac" | "windows" | "linux";

export const DESKTOP_DOWNLOAD_IDS = [
	"mac-arm64",
	"mac-x64",
	"windows",
	"linux",
] as const;

export type DesktopDownloadId = (typeof DESKTOP_DOWNLOAD_IDS)[number];

export interface DesktopDownload {
	readonly id: DesktopDownloadId;
	readonly os: DesktopOs;
	readonly label: string;
	readonly file: string;
	readonly url: string;
}

function download(
	id: DesktopDownloadId,
	os: DesktopOs,
	label: string,
	file: string,
): DesktopDownload {
	return { id, os, label, file, url: `${LATEST}/${file}` };
}

export const DESKTOP_DOWNLOADS: readonly DesktopDownload[] = [
	download("mac-arm64", "mac", "macOS, Apple silicon", "salsal-arm64.dmg"),
	download("mac-x64", "mac", "macOS, Intel", "salsal-x64.dmg"),
	download("windows", "windows", "Windows", "salsal-setup.exe"),
	download("linux", "linux", "Linux, AppImage", "salsal.AppImage"),
];

function osOf(platform: string): DesktopOs | undefined {
	const name = platform.toLowerCase();
	if (/mac|iphone|ipad/.test(name)) return "mac";
	if (/win/.test(name)) return "windows";
	if (/linux|x11|cros/.test(name)) return "linux";
	return undefined;
}

export function visitorPlatform(): string {
	if (typeof navigator === "undefined") return "";
	const hinted = (navigator as { userAgentData?: { platform?: string } })
		.userAgentData?.platform;
	return hinted !== undefined && hinted !== "" ? hinted : navigator.userAgent;
}

export function primaryDownload(platform: string): DesktopDownload | undefined {
	const os = osOf(platform);
	return DESKTOP_DOWNLOADS.find((download) => download.os === os);
}

export function isDownloadId(value: unknown): value is DesktopDownloadId {
	return DESKTOP_DOWNLOAD_IDS.some((id) => id === value);
}

export function chosenDownload(
	id: DesktopDownloadId | undefined,
	platform: string,
): DesktopDownload | undefined {
	return (
		DESKTOP_DOWNLOADS.find((download) => download.id === id) ??
		primaryDownload(platform)
	);
}

export function startDownload(url: string, doc: Document = document): void {
	const frame = doc.createElement("iframe");
	frame.hidden = true;
	frame.src = url;
	doc.body.append(frame);
}
