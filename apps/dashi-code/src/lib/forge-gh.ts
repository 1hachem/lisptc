import { dashiCodesEnv } from "@repo/env/dashi-codes";
import { z } from "zod";
import type { Forge, Pull, PullState } from "./forge.ts";
import { exec } from "./repo.ts";

const DETAIL_CONCURRENCY = 8;

const LIST_FIELDS = [
	"number",
	"title",
	"author",
	"url",
	"state",
	"isDraft",
	"createdAt",
	"closedAt",
	"mergedAt",
	"baseRefName",
	"headRefName",
	"additions",
	"deletions",
	"changedFiles",
].join(",");

const listSchema = z.array(
	z.object({
		number: z.number(),
		title: z.string(),
		author: z.object({ login: z.string().nullish() }).nullish(),
		url: z.string(),
		state: z.string(),
		isDraft: z.boolean().nullish(),
		createdAt: z.string(),
		closedAt: z.string().nullish(),
		mergedAt: z.string().nullish(),
		baseRefName: z.string(),
		headRefName: z.string(),
		additions: z.number().nullish(),
		deletions: z.number().nullish(),
		changedFiles: z.number().nullish(),
	}),
);

const detailSchema = z.object({
	commits: z
		.array(
			z.object({
				oid: z.string(),
				committedDate: z.string(),
				messageHeadline: z.string().nullish(),
			}),
		)
		.default([]),
	files: z
		.array(
			z.object({
				path: z.string(),
				additions: z.number().nullish(),
				deletions: z.number().nullish(),
			}),
		)
		.default([]),
});

type Listed = z.infer<typeof listSchema>[number];
type Detail = z.infer<typeof detailSchema>;

function stateOf(listed: Listed): PullState {
	if (listed.mergedAt != null) return "merged";
	return listed.state.toUpperCase() === "OPEN" ? "open" : "closed";
}

function scoped(args: string[]): string[] {
	const named = dashiCodesEnv.DASHI_CODES_FORGE_REPO;
	return named === undefined ? args : [...args, "--repo", named];
}

async function gh<T>(args: string[], schema: z.ZodType<T>): Promise<T> {
	const { stdout } = await exec("gh", scoped(args));
	const parsed = schema.safeParse(JSON.parse(stdout));
	if (!parsed.success)
		throw new Error(
			`gh ${args[0]} ${args[1]} answered with a shape this reader does not know: ${parsed.error.issues[0]?.message ?? "unknown field"}`,
		);
	return parsed.data;
}

async function pool<T, R>(
	items: T[],
	width: number,
	run: (item: T) => Promise<R>,
): Promise<R[]> {
	const out: R[] = new Array(items.length);
	let next = 0;
	const worker = async (): Promise<void> => {
		while (next < items.length) {
			const at = next++;
			const item = items[at];
			if (item === undefined) continue;
			out[at] = await run(item);
		}
	};
	await Promise.all(
		Array.from({ length: Math.min(width, items.length) }, worker),
	);
	return out;
}

function shape(listed: Listed, detail: Detail): Pull {
	return {
		number: listed.number,
		title: listed.title,
		author: listed.author?.login ?? "unknown",
		url: listed.url,
		state: stateOf(listed),
		draft: listed.isDraft ?? false,
		openedAt: listed.createdAt,
		closedAt: listed.closedAt ?? null,
		mergedAt: listed.mergedAt ?? null,
		base: listed.baseRefName,
		head: listed.headRefName,
		added: listed.additions ?? 0,
		deleted: listed.deletions ?? 0,
		changed: listed.changedFiles ?? detail.files.length,
		commits: detail.commits.map((commit) => ({
			sha: commit.oid,
			at: commit.committedDate,
			headline: commit.messageHeadline ?? "",
		})),
		files: detail.files.map((file) => ({
			path: file.path,
			added: file.additions ?? 0,
			deleted: file.deletions ?? 0,
		})),
	};
}

export function ghForge(): Forge {
	return {
		describe: () => `gh:${dashiCodesEnv.DASHI_CODES_FORGE_REPO ?? "origin"}`,
		pulls: async (limit) => {
			const listed = await gh(
				[
					"pr",
					"list",
					"--state",
					"all",
					"--limit",
					String(limit),
					"--json",
					LIST_FIELDS,
				],
				listSchema,
			);
			return await pool(listed, DETAIL_CONCURRENCY, async (one) =>
				shape(
					one,
					await gh(
						["pr", "view", String(one.number), "--json", "commits,files"],
						detailSchema,
					),
				),
			);
		},
	};
}
