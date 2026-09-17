import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { convexDeployEnv } from "@repo/env/convex";

const DEPLOYMENT_URL = "http://127.0.0.1:3210";
const ENV_FILE = "packages/backend/.env.local";

function convex(args: string[], inherit = false): string {
	return execFileSync(
		"pnpm",
		["--silent", "--filter", "@repo/backend", "exec", "convex", ...args],
		{ encoding: "utf8", stdio: inherit ? "inherit" : "pipe" },
	);
}

const printed = execFileSync(
	"docker",
	["compose", "exec", "-T", "convex-backend", "./generate_admin_key.sh"],
	{ encoding: "utf8" },
)
	.trim()
	.split("\n");
const key = printed.at(-1)?.trim();

if (!key) throw new Error("the backend printed no admin key");

writeFileSync(
	ENV_FILE,
	`CONVEX_SELF_HOSTED_URL=${DEPLOYMENT_URL}\nCONVEX_SELF_HOSTED_ADMIN_KEY=${key}\n`,
);
console.info(`wrote ${ENV_FILE}`);

for (const [name, value] of Object.entries(convexDeployEnv)) {
	if (typeof value !== "string") continue;
	convex(["env", "set", name, value]);
	console.info(`set ${name} on the deployment`);
}

convex(["dev", "--once"], true);
