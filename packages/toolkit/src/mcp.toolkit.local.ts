import type { MachineEntry } from "./entry.ts";

export const machineEntries: readonly MachineEntry[] = [
	{
		name: "local-files",
		description:
			"Read, write, search and list files in the user's home folder, on the user's own machine.",
		keywords: [
			"file",
			"files",
			"folder",
			"directory",
			"home",
			"read",
			"write",
			"edit",
			"search",
			"local",
			"disk",
			"machine",
		],
		command: "npx",
		args: ["-y", "@modelcontextprotocol/server-filesystem", "~"],
	},
	{
		name: "local-git",
		description:
			"Inspect and change git repositories on the user's own machine: status, diff, log, branch, stage and commit.",
		keywords: [
			"git",
			"repository",
			"repo",
			"commit",
			"diff",
			"log",
			"branch",
			"status",
			"stage",
			"version control",
			"local",
			"machine",
		],
		command: "uvx",
		args: ["mcp-server-git"],
	},
	{
		name: "playwright",
		description:
			"Drive a Chromium browser on the user's own machine: navigate, click, type, snapshot the accessibility tree, screenshot, and read network requests.",
		command: "npx",
		args: [
			"-y",
			"@playwright/mcp@0.0.81",
			"--browser",
			"chromium",
			"--isolated",
		],
		flags: {
			headless: ["--headless"],
		},
	},
	{
		name: "playwright-docker",
		description:
			"Drive a headless Chromium browser in a container on the user's own docker: navigate, click, type, snapshot the accessibility tree, screenshot, and read network requests.",
		keywords: [
			"browser",
			"chromium",
			"playwright",
			"web",
			"navigate",
			"screenshot",
			"docker",
			"container",
			"local",
			"machine",
		],
		image: "ghcr.io/1hachem/lisptc-mcp-playwright:main",
		internal: true,
		port: 8931,
	},
];
