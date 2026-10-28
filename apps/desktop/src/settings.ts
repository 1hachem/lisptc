import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { desktopEnv } from "@repo/env/desktop";
import { app } from "electron";

export interface DesktopSettings {
	closeToTray: boolean;
	openAtLogin: boolean;
}

const DEFAULTS: DesktopSettings = { closeToTray: true, openAtLogin: false };

function file(): string {
	return path.join(app.getPath("userData"), "settings.json");
}

export function readSettings(): DesktopSettings {
	try {
		const stored = JSON.parse(readFileSync(file(), "utf8"));
		return {
			closeToTray:
				typeof stored.closeToTray === "boolean"
					? stored.closeToTray
					: DEFAULTS.closeToTray,
			openAtLogin:
				typeof stored.openAtLogin === "boolean"
					? stored.openAtLogin
					: DEFAULTS.openAtLogin,
		};
	} catch {
		return { ...DEFAULTS };
	}
}

export function writeSettings(settings: DesktopSettings): void {
	mkdirSync(path.dirname(file()), { recursive: true });
	writeFileSync(file(), JSON.stringify(settings, null, 2));
}

function linuxAutostartFile(): string {
	const xdg = desktopEnv.XDG_CONFIG_HOME;
	const config =
		xdg !== undefined && path.isAbsolute(xdg)
			? xdg
			: path.join(homedir(), ".config");
	return path.join(config, "autostart", "lisptc.desktop");
}

export function applyOpenAtLogin(enabled: boolean): void {
	if (!app.isPackaged) return;
	if (process.platform !== "linux") {
		app.setLoginItemSettings({ openAtLogin: enabled, args: ["--hidden"] });
		return;
	}
	const entry = linuxAutostartFile();
	if (!enabled) {
		rmSync(entry, { force: true });
		return;
	}
	const executable = desktopEnv.APPIMAGE ?? process.execPath;
	mkdirSync(path.dirname(entry), { recursive: true });
	writeFileSync(
		entry,
		[
			"[Desktop Entry]",
			"Type=Application",
			"Name=lisptc",
			`Exec="${executable}" --hidden`,
			"X-GNOME-Autostart-enabled=true",
			"",
		].join("\n"),
	);
}

export function startedHidden(): boolean {
	return (
		process.argv.includes("--hidden") ||
		(process.platform === "darwin" &&
			app.getLoginItemSettings().wasOpenedAtLogin === true)
	);
}
