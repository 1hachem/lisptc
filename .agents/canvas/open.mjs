import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

function opener() {
	if (process.platform === "darwin") return ["open", []];
	if (process.platform === "win32") return ["cmd", ["/c", "start", ""]];
	return ["xdg-open", []];
}

const path = process.argv[2];

if (!path) {
	console.error("Provide an HTML file path.");
	process.exit(1);
}

const url = pathToFileURL(resolve(path)).href;
const [cmd, args] = opener();
spawn(cmd, [...args, url], { detached: true, stdio: "ignore" }).unref();
console.log(url);
