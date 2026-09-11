import { readFileSync } from "node:fs";
import type { MockServer, MockTool } from "@repo/evals/mocks";

const tools = JSON.parse(
	readFileSync(new URL("./linear.tools.json", import.meta.url), "utf8"),
) as MockTool[];

interface Issue {
	identifier: string;
	title: string;
	state: string;
	priority: string;
	assignee: string;
	updatedAt: string;
	url: string;
}

const ME = "Hachem Betrouni";

const ISSUES: Issue[] = [
	{
		identifier: "ENG-142",
		title: "Refresh token rotation drops the session",
		state: "In Progress",
		priority: "Urgent",
		assignee: ME,
		updatedAt: "2026-09-09T08:12:00.000Z",
		url: "https://linear.app/lisptc/issue/ENG-142",
	},
	{
		identifier: "ENG-138",
		title: "Grammar rejects a nested quasiquote",
		state: "Todo",
		priority: "High",
		assignee: ME,
		updatedAt: "2026-09-08T17:40:00.000Z",
		url: "https://linear.app/lisptc/issue/ENG-138",
	},
	{
		identifier: "ENG-131",
		title: "Compaction counts a window's words twice",
		state: "Todo",
		priority: "Medium",
		assignee: ME,
		updatedAt: "2026-09-05T11:02:00.000Z",
		url: "https://linear.app/lisptc/issue/ENG-131",
	},
	{
		identifier: "ENG-127",
		title: "Session server leaks a client on reset",
		state: "Backlog",
		priority: "Medium",
		assignee: ME,
		updatedAt: "2026-09-02T09:55:00.000Z",
		url: "https://linear.app/lisptc/issue/ENG-127",
	},
	{
		identifier: "DES-44",
		title: "Trace viewer crowds the check column",
		state: "Backlog",
		priority: "Low",
		assignee: ME,
		updatedAt: "2026-08-28T14:31:00.000Z",
		url: "https://linear.app/lisptc/issue/DES-44",
	},
	{
		identifier: "ENG-150",
		title: "Bump pnpm to 10",
		state: "Todo",
		priority: "Low",
		assignee: "Nadia Cherif",
		updatedAt: "2026-09-10T10:00:00.000Z",
		url: "https://linear.app/lisptc/issue/ENG-150",
	},
	{
		identifier: "OPS-12",
		title: "Rotate the Infisical machine identity",
		state: "In Progress",
		priority: "High",
		assignee: "Karim Haddad",
		updatedAt: "2026-09-07T16:20:00.000Z",
		url: "https://linear.app/lisptc/issue/OPS-12",
	},
];

function listIssues(args: Record<string, unknown>): Issue[] {
	const assignee = args.assignee ? String(args.assignee) : undefined;
	const state = args.state ? String(args.state).toLowerCase() : undefined;
	const limit = args.limit ? Number(args.limit) : ISSUES.length;
	return ISSUES.filter((issue) => {
		if (assignee === "me" && issue.assignee !== ME) return false;
		if (assignee && assignee !== "me" && issue.assignee !== assignee)
			return false;
		if (state && issue.state.toLowerCase() !== state) return false;
		return true;
	}).slice(0, limit);
}

export const linear: MockServer = {
	tools,
	connectDelayMs: 40,
	calls: {
		list_issues: listIssues,
		get_issue: (args) =>
			ISSUES.find((issue) => issue.identifier === String(args.id)) ?? {
				error: `no such issue: ${args.id}`,
			},
		list_teams: [
			{ id: "team_eng", key: "ENG", name: "Engineering" },
			{ id: "team_des", key: "DES", name: "Design" },
			{ id: "team_ops", key: "OPS", name: "Operations" },
		],
		list_users: [
			{ id: "user_me", name: ME, email: "sah@big-mama.io", isMe: true },
			{ id: "user_nadia", name: "Nadia Cherif", email: "nadia@big-mama.io" },
			{ id: "user_karim", name: "Karim Haddad", email: "karim@big-mama.io" },
		],
		list_projects: [
			{ id: "proj_repl", name: "REPL", state: "started" },
			{ id: "proj_evals", name: "Eval suite", state: "planned" },
		],
	},
};
