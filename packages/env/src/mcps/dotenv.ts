import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

function findEnvFile(from: string): string | undefined {
	let dir = from;
	for (;;) {
		const file = join(dir, ".env");
		if (existsSync(file)) return file;
		const parent = dirname(dir);
		if (parent === dir) return undefined;
		dir = parent;
	}
}

export function loadNearestEnvFile(): void {
	const file = findEnvFile(process.env.INIT_CWD || process.cwd());
	if (!file) return;
	const inherited = { ...process.env };
	try {
		process.loadEnvFile(file);
	} catch {
		return;
	}
	for (const [key, value] of Object.entries(inherited)) {
		if (value !== undefined) process.env[key] = value;
	}
}

interface ValidationIssue {
	readonly message: string;
	readonly path?: readonly unknown[];
}

function issueName(issue: ValidationIssue): string {
	const segment = issue.path?.[0];
	if (typeof segment === "string") return segment;
	if (
		segment &&
		typeof segment === "object" &&
		"key" in segment &&
		typeof segment.key === "string"
	) {
		return segment.key;
	}
	return issue.message;
}

export function missing(params: {
	server: string;
	path: string;
	task: string;
}) {
	return (issues: readonly ValidationIssue[]): never => {
		const names = [...new Set(issues.map(issueName))];
		const verb = names.length > 1 ? "are" : "is";
		throw new Error(
			`the ${params.server} MCP server cannot start: ${names.join(", ")} ${verb} not set. They come from Infisical at ${params.path}, so start it with "task ${params.task}" and check that path has them. A project .env is read as a fallback.`,
		);
	};
}
