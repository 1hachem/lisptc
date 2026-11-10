export type DockerTrouble = "missing" | "stopped";

const DESKTOP_INSTALL: Partial<Record<NodeJS.Platform, string>> = {
	darwin:
		"Install Docker Desktop from https://docs.docker.com/desktop/setup/install/mac-install/ (or run `brew install --cask docker`), then open it once so its engine starts.",
	win32:
		"Install Docker Desktop from https://docs.docker.com/desktop/setup/install/windows-install/ (or run `winget install Docker.DockerDesktop`), then open it once so its engine starts.",
};

const ENGINE_INSTALL =
	"Install Docker Engine for your distribution from https://docs.docker.com/engine/install/, start it with `sudo systemctl enable --now docker`, then let your user reach it with `sudo usermod -aG docker $USER` and log out and back in.";

const DESKTOP_START =
	"Open Docker Desktop and wait until it shows the engine running.";

const ENGINE_START =
	"Start it with `sudo systemctl start docker`. If it is already running, your user cannot reach its socket: run `sudo usermod -aG docker $USER`, then log out and back in.";

function remedy(trouble: DockerTrouble, platform: NodeJS.Platform): string {
	const desktop = platform in DESKTOP_INSTALL;
	if (trouble === "stopped") return desktop ? DESKTOP_START : ENGINE_START;
	const install = DESKTOP_INSTALL[platform] ?? ENGINE_INSTALL;
	return `If docker is installed, the app cannot find it on its PATH: start the app from a terminal, or put docker where the system looks. Otherwise: ${install}`;
}

function finding(trouble: DockerTrouble): string {
	return trouble === "missing"
		? "no docker command can be found on this machine"
		: "docker is installed but its engine is not answering";
}

export class DockerUnavailable extends Error {
	constructor(
		readonly server: string,
		readonly trouble: DockerTrouble,
		platform: NodeJS.Platform = process.platform,
	) {
		super(
			`${server} runs in a docker container, but ${finding(trouble)}. ${remedy(trouble, platform)} Then load ${server} again.`,
		);
		this.name = "DockerUnavailable";
	}
}
