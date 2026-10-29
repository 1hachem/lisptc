import { app } from "electron";
import electronUpdater from "electron-updater";

const UPDATE_CHECK_EVERY_MS = 4 * 60 * 60 * 1000;

export type UpdateState =
	| { status: "idle" }
	| { status: "available"; version: string }
	| { status: "downloaded"; version: string };

export interface Updates {
	state(): UpdateState;
	check(): void;
	install(): void;
}

export function startUpdates(
	changed: (state: UpdateState) => void,
	installing: () => void,
): Updates {
	const { autoUpdater } = electronUpdater;
	let state: UpdateState = { status: "idle" };
	const set = (next: UpdateState) => {
		state = next;
		changed(state);
	};
	const check = () => {
		if (!app.isPackaged || state.status === "downloaded") return;
		autoUpdater.checkForUpdates().catch(() => undefined);
	};
	if (app.isPackaged) {
		autoUpdater.on("update-available", ({ version }) =>
			set({ status: "available", version }),
		);
		autoUpdater.on("update-downloaded", ({ version }) =>
			set({ status: "downloaded", version }),
		);
		autoUpdater.on("error", () => {
			if (state.status !== "downloaded") set({ status: "idle" });
		});
		check();
		setInterval(check, UPDATE_CHECK_EVERY_MS);
	}
	return {
		state: () => state,
		check,
		install: () => {
			if (state.status !== "downloaded") return;
			installing();
			autoUpdater.quitAndInstall();
		},
	};
}
