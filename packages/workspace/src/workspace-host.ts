import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import {
	basename,
	dirname,
	isAbsolute,
	join,
	relative,
	resolve,
	sep,
} from "node:path";
import { filePrompt } from "@repo/shared/host-node";
import {
	MANIFEST,
	scaffold,
	type WorkspaceFiles,
	type WorkspaceHistory,
	type WorkspaceHost,
} from "./ports.ts";

function toPosix(path: string): string {
	return path.split(sep).join("/");
}

export class DiskWorkspaceFiles implements WorkspaceFiles {
	constructor(readonly root: string) {}

	private abs(path: string): string {
		const abs = resolve(this.root, path);
		const rel = relative(this.root, abs);
		if (rel.startsWith("..") || isAbsolute(rel))
			throw new Error(`path escapes the workspace: ${path}`);
		return abs;
	}

	read(path: string): string | undefined {
		try {
			return readFileSync(this.abs(path), "utf8");
		} catch {
			return undefined;
		}
	}

	write(path: string, text: string): void {
		const abs = this.abs(path);
		mkdirSync(dirname(abs), { recursive: true });
		writeFileSync(abs, text);
	}

	remove(path: string): boolean {
		const abs = this.abs(path);
		if (!existsSync(abs)) return false;
		rmSync(abs, { force: true });
		return true;
	}

	list(dir: string): string[] {
		const base = this.abs(dir);
		if (!existsSync(base)) return [];
		return readdirSync(base, { recursive: true, withFileTypes: true })
			.filter((entry) => entry.isFile())
			.map((entry) =>
				toPosix(relative(this.root, join(entry.parentPath, entry.name))),
			);
	}
}

function git(root: string, args: readonly string[]): string {
	return execFileSync("git", ["-C", root, ...args], {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	});
}

function hasIdentity(root: string): boolean {
	try {
		return git(root, ["config", "user.email"]).trim() !== "";
	} catch {
		return false;
	}
}

function commitAs(root: string, args: readonly string[]): void {
	const identity = hasIdentity(root)
		? []
		: ["-c", "user.name=lisptc", "-c", "user.email=lisptc@localhost"];
	git(root, [...identity, "commit", "--quiet", ...args]);
}

export class GitHistory implements WorkspaceHistory {
	constructor(readonly root: string) {}

	commit(message: string, paths: readonly string[]): void {
		for (const path of paths) {
			if (existsSync(join(this.root, path)))
				git(this.root, ["add", "--all", "--", path]);
			else
				git(this.root, [
					"rm",
					"-r",
					"--cached",
					"--quiet",
					"--ignore-unmatch",
					"--",
					path,
				]);
		}
		const staged = git(this.root, [
			"diff",
			"--cached",
			"--name-only",
			"--",
			...paths,
		])
			.split("\n")
			.filter((line) => line !== "");
		if (staged.length === 0) return;
		commitAs(this.root, [
			"--only",
			"--message",
			`lisptc: ${message}`,
			"--",
			...staged,
		]);
	}
}

export function findWorkspace(from: string): string | undefined {
	let dir = resolve(from);
	for (;;) {
		if (existsSync(join(dir, MANIFEST))) return dir;
		const parent = dirname(dir);
		if (parent === dir) return undefined;
		dir = parent;
	}
}

export function initWorkspace(dir: string): string {
	const root = resolve(dir);
	if (existsSync(join(root, MANIFEST)))
		throw new Error(`${root} is already a workspace`);
	const files = new DiskWorkspaceFiles(root);
	const written = scaffold(basename(root));
	for (const [path, text] of written) files.write(path, text);
	if (!existsSync(join(root, ".git"))) git(root, ["init", "--quiet"]);
	git(root, ["add", "--", ...written.keys()]);
	commitAs(root, ["--message", "lisptc: init workspace"]);
	return root;
}

const workspacePrompt = filePrompt(new URL("./workspace.ptc", import.meta.url));

export function workspaceHostFor(root: string): WorkspaceHost {
	return {
		files: new DiskWorkspaceFiles(root),
		history: existsSync(join(root, ".git")) ? new GitHistory(root) : undefined,
		prompt: workspacePrompt,
	};
}
