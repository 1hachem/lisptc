import { useConvexAction, useConvexMutation } from "@convex-dev/react-query";
import { api } from "@repo/backend/api";
import type { Id } from "@repo/backend/dataModel";
import { Button, Input } from "@repo/ui";
import { ConvexError } from "convex/values";
import { useState } from "react";

type Choice = "own" | "hosted";

const PROBLEMS: Record<string, string> = {
	BAD_URL:
		"that is not an https clone URL. Use the repository's https address, without a username in it.",
	NOT_FOUND: "no repository answers at that URL. Create it first, then retry.",
	NO_ACCESS:
		"the remote refused the token. Check that it is valid and not expired.",
	READ_ONLY:
		"the token can read this repository but cannot push to it. Give it write access to the contents.",
	UNREACHABLE: "the remote did not answer like a git server. Check the URL.",
	GIT_CREDENTIALS_UNCONFIGURED:
		"this deployment cannot store git credentials yet: its credential key is not set.",
	GIT_CREDENTIAL_TOO_LARGE: "that token is too long to be a git token.",
	HOSTED_GIT_UNAVAILABLE:
		"hosted repositories are not available on this deployment. Connect your own remote, or skip for now.",
	HOSTED_GIT_FAILED:
		"the hosted repository could not be created. Try again in a moment.",
};

function explain(code: string): string {
	return PROBLEMS[code] ?? code;
}

function failureText(ex: unknown): string {
	if (ex instanceof ConvexError) {
		const code = (ex.data as { code?: unknown } | null)?.code;
		if (typeof code === "string") return explain(code);
	}
	return ex instanceof Error ? ex.message : String(ex);
}

const field = "h-7 rounded-none border-bg2 bg-bg1 text-[11.5px]";
const option = (active: boolean) =>
	`w-full cursor-pointer border px-3 py-2 text-left text-[11.5px] ${
		active ? "border-fg text-fg" : "border-bg2 text-dim hover:text-fg"
	}`;

export function RemoteSetup({
	workspaceId,
}: {
	workspaceId: Id<"workspaces">;
}) {
	const connect = useConvexAction(api.remotes.connect);
	const host = useConvexAction(api.remotes.host);
	const skip = useConvexMutation(api.remotes.skip);
	const [choice, setChoice] = useState<Choice>("own");
	const [url, setUrl] = useState("");
	const [username, setUsername] = useState("");
	const [token, setToken] = useState("");
	const [busy, setBusy] = useState(false);
	const [failure, setFailure] = useState<string | null>(null);

	const run = async (work: () => Promise<{ problem?: string } | null>) => {
		setBusy(true);
		setFailure(null);
		try {
			const result = await work();
			if (result?.problem) setFailure(explain(result.problem));
		} catch (ex) {
			setFailure(failureText(ex));
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className="mx-auto flex max-w-[520px] flex-col gap-4 px-4 py-10 text-[11.5px]">
			<div className="flex flex-col gap-1">
				<h1 className="text-[13px] text-fg">
					where should this workspace live?
				</h1>
				<p className="text-dim">
					A workspace is a git repository of .ptc files. What the agent saves is
					committed there, so you can read it, edit it and see its history.
				</p>
			</div>

			<div className="flex flex-col gap-2">
				<button
					type="button"
					className={option(choice === "own")}
					onClick={() => setChoice("own")}
				>
					my own git remote
					<span className="block text-dim">
						GitHub, GitLab or any https git server you can push to.
					</span>
				</button>
				<button
					type="button"
					className={option(choice === "hosted")}
					onClick={() => setChoice("hosted")}
				>
					host it for me
					<span className="block text-dim">
						No git account needed. You can move it to your own remote later.
					</span>
				</button>
			</div>

			{choice === "own" ? (
				<form
					className="flex flex-col gap-2"
					onSubmit={(event) => {
						event.preventDefault();
						void run(() =>
							connect({
								workspaceId,
								url,
								token,
								...(username.trim() ? { username } : {}),
							}),
						);
					}}
				>
					<Input
						className={field}
						placeholder="https://github.com/you/repo.git"
						value={url}
						onChange={(event) => setUrl(event.target.value)}
						autoComplete="off"
					/>
					<Input
						className={field}
						placeholder="username (optional for a GitHub token)"
						value={username}
						onChange={(event) => setUsername(event.target.value)}
						autoComplete="off"
					/>
					<Input
						className={field}
						type="password"
						placeholder="access token"
						value={token}
						onChange={(event) => setToken(event.target.value)}
						autoComplete="off"
					/>
					<p className="text-dim">
						GitHub: a fine-grained token on this one repository, with Contents
						set to read and write. GitLab: a project access token with
						write_repository. The token is checked for push access, stored
						encrypted, and never shown to the agent.
					</p>
					<Button
						type="submit"
						size="sm"
						disabled={busy || url.trim() === "" || token.trim() === ""}
					>
						{busy ? "checking access…" : "connect"}
					</Button>
				</form>
			) : (
				<Button
					size="sm"
					disabled={busy}
					onClick={() => void run(() => host({ workspaceId }))}
				>
					{busy ? "creating the repository…" : "create a hosted repository"}
				</Button>
			)}

			{failure && <div className="text-red">{failure}</div>}

			<button
				type="button"
				className="self-start cursor-pointer text-dim hover:text-fg"
				disabled={busy}
				onClick={() =>
					void run(async () => {
						await skip({ workspaceId });
						return null;
					})
				}
			>
				skip for now: keep it in lisptc only
			</button>
		</div>
	);
}
