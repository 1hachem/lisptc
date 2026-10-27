import { desktopEnv } from "@repo/env/desktop";
import { app, BrowserWindow, shell } from "electron";
import electronUpdater from "electron-updater";

const origin = new URL(desktopEnv.LISPTC_DESKTOP_URL).origin;

function sameOrigin(url: string): boolean {
	try {
		return new URL(url).origin === origin;
	} catch {
		return false;
	}
}

function open(): BrowserWindow {
	const window = new BrowserWindow({
		width: 1280,
		height: 840,
		title: "lisptc",
		webPreferences: { contextIsolation: true, sandbox: true },
	});
	window.webContents.setWindowOpenHandler(({ url }) => {
		if (sameOrigin(url)) return { action: "allow" };
		void shell.openExternal(url);
		return { action: "deny" };
	});
	window.webContents.on("will-navigate", (event, url) => {
		if (sameOrigin(url)) return;
		event.preventDefault();
		void shell.openExternal(url);
	});
	void window.loadURL(desktopEnv.LISPTC_DESKTOP_URL);
	return window;
}

if (!app.requestSingleInstanceLock()) app.quit();

app.setAsDefaultProtocolClient("lisptc");

app.on("second-instance", () => {
	const [window] = BrowserWindow.getAllWindows();
	if (window === undefined) return;
	if (window.isMinimized()) window.restore();
	window.focus();
});

app.whenReady().then(() => {
	open();
	if (app.isPackaged)
		void electronUpdater.autoUpdater.checkForUpdatesAndNotify();
	app.on("activate", () => {
		if (BrowserWindow.getAllWindows().length === 0) open();
	});
});

app.on("window-all-closed", () => {
	if (process.platform !== "darwin") app.quit();
});
