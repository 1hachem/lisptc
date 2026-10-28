const LATEST = "https://github.com/1hachem/lisptc/releases/latest/download";

export type DesktopOs = "mac" | "windows" | "linux";

export interface DesktopDownload {
	readonly os: DesktopOs;
	readonly label: string;
	readonly url: string;
}

export const DESKTOP_DOWNLOADS: readonly DesktopDownload[] = [
	{
		os: "mac",
		label: "macOS, Apple silicon",
		url: `${LATEST}/salsal-arm64.dmg`,
	},
	{ os: "mac", label: "macOS, Intel", url: `${LATEST}/salsal-x64.dmg` },
	{ os: "windows", label: "Windows", url: `${LATEST}/salsal-setup.exe` },
	{ os: "linux", label: "Linux, AppImage", url: `${LATEST}/salsal.AppImage` },
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
