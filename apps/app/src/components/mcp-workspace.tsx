import { convexQuery } from "@convex-dev/react-query";
import { McpServerIcon, PackageIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { api } from "@repo/backend/api";
import type { Id } from "@repo/backend/dataModel";
import type {
	McpAction,
	McpActionResult,
	ToolkitEntry,
} from "@repo/backend/mcp-actions";
import { ConfirmDialog, TreeFile, TreeFolder } from "@repo/components";
import { Button } from "@repo/ui";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { postMcpAction, toolkitQuery } from "../lib/mcp-action.ts";
import { dragsAs, type PanelContent } from "../lib/panel-ops.ts";
import { requestPanel, requestPanelClosed } from "../lib/panel-requests.ts";
import { FileMenu } from "./file-menu.tsx";
import { PageView } from "./file-view.tsx";
import {
	type McpPhase,
	PhaseDot,
	useWorkspaceMcpServers,
	type WorkspaceMcpServer,
} from "./mcp-servers.tsx";
import { linkTo, useShown } from "./panel-link.tsx";
import { Field } from "./read-only.tsx";
import { type FolderState, Listing } from "./tree-listing.tsx";

function mcpPage(server: string): PanelContent {
	return { kind: "page", page: "mcp", id: server, title: `mcp/${server}` };
}

const TOOLKIT_PAGE: PanelContent = {
	kind: "page",
	page: "toolkit",
	title: "mcp/toolkit",
};

function useToolkit(): ToolkitEntry[] | undefined {
	return useQuery(toolkitQuery()).data;
}

function useSignedIn(workspaceId: Id<"workspaces">): ReadonlySet<string> {
	const { data } = useQuery(convexQuery(api.oauth.signedIn, { workspaceId }));
	return new Set(data ?? []);
}

function signedInTo(
	signedIn: ReadonlySet<string>,
	server: string,
	listed: ToolkitEntry | undefined,
): boolean {
	return signedIn.has(listed?.loginKey ?? `mcp:${server}`);
}

function fromToolkit(entry: ToolkitEntry): WorkspaceMcpServer {
	return {
		server: entry.server,
		mounted: false,
		...(entry.description === undefined
			? {}
			: { description: entry.description }),
		...(entry.icon === undefined ? {} : { icon: entry.icon }),
		login: entry.login,
		tools: [],
	};
}

function withToolkit(
	known: WorkspaceMcpServer | undefined,
	listed: ToolkitEntry | undefined,
): WorkspaceMcpServer | undefined {
	if (listed === undefined) return known;
	if (known === undefined) return fromToolkit(listed);
	return {
		...known,
		description: known.description ?? listed.description,
		icon: known.icon ?? listed.icon,
		login: known.login || listed.login,
	};
}

function useMcpServer(workspaceId: Id<"workspaces">, server: string) {
	const servers = useWorkspaceMcpServers(workspaceId);
	const toolkit = useToolkit();
	const signedIn = useSignedIn(workspaceId);
	const known = servers?.find((found) => found.server === server);
	const listed = toolkit?.find((found) => found.server === server);
	return {
		loading: servers === undefined,
		known: known !== undefined,
		entry: withToolkit(known, listed),
		signedIn: signedInTo(signedIn, server, listed),
	};
}

function McpLogo({ icon }: { icon: string | undefined }) {
	if (icon === undefined)
		return <HugeiconsIcon className="size-icon-sm" icon={McpServerIcon} />;
	return (
		<img
			src={icon}
			alt=""
			referrerPolicy="no-referrer"
			className="size-icon-sm flex-none rounded-xs object-contain"
		/>
	);
}

function phaseText(entry: WorkspaceMcpServer): string {
	if (entry.phase === undefined) return "not running";
	return entry.reason ? `${entry.phase}: ${entry.reason}` : entry.phase;
}

function landLink(link: Window | null, result: McpActionResult): void {
	if (link === null) return;
	if ("url" in result && result.url !== undefined)
		link.location.href = result.url;
	else link.close();
}

async function attempt(
	workspaceId: Id<"workspaces">,
	server: string,
	action: McpAction,
): Promise<McpActionResult> {
	try {
		return await postMcpAction(workspaceId, server, action);
	} catch (ex) {
		return { error: ex instanceof Error ? ex.message : String(ex) };
	}
}

function useMcpAction(workspaceId: Id<"workspaces">, server: string) {
	const [busy, setBusy] = useState<McpAction | null>(null);
	const [error, setError] = useState<string | null>(null);
	const perform = async (action: McpAction) => {
		setBusy(action);
		setError(null);
		const link = action === "login" ? window.open("", "_blank") : null;
		const result = await attempt(workspaceId, server, action);
		landLink(link, result);
		setBusy(null);
		if ("error" in result) setError(result.error);
		else if (action === "remove") requestPanelClosed(mcpPage(server));
		return result;
	};
	const run = async (action: McpAction) => {
		await perform(action);
	};
	const runOrThrow = async (action: McpAction) => {
		const result = await perform(action);
		if ("error" in result) throw new Error(result.error);
	};
	return { busy, error, run, runOrThrow };
}

function McpFile({
	workspaceId,
	entry,
}: {
	workspaceId: Id<"workspaces">;
	entry: WorkspaceMcpServer;
}) {
	const shown = useShown();
	const page = mcpPage(entry.server);
	const { runOrThrow } = useMcpAction(workspaceId, entry.server);
	return (
		<TreeFile
			name={entry.server}
			glyph={<McpLogo icon={entry.icon} />}
			depth={1}
			selected={shown(page)}
			onDragStart={dragsAs(page)}
			trailing={
				<span className="flex items-center gap-1.5">
					<PhaseDot phase={entry.phase} />
					<FileMenu
						name={entry.server}
						confirm="delete this server and everything it holds?"
						onDelete={() => runOrThrow("remove")}
					/>
				</span>
			}
			link={linkTo(workspaceId, page)}
		/>
	);
}

function ToolkitFile({ workspaceId }: { workspaceId: Id<"workspaces"> }) {
	const shown = useShown();
	return (
		<TreeFile
			name="toolkit"
			icon={PackageIcon}
			depth={1}
			selected={shown(TOOLKIT_PAGE)}
			onDragStart={dragsAs(TOOLKIT_PAGE)}
			link={linkTo(workspaceId, TOOLKIT_PAGE)}
		/>
	);
}

export function McpFolder({
	workspaceId,
	folder,
}: {
	workspaceId: Id<"workspaces">;
	folder: FolderState<"mcp">;
}) {
	const servers = useWorkspaceMcpServers(workspaceId);
	return (
		<TreeFolder
			{...folder}
			onCreate="disabled"
			createLabel="load one from the toolkit"
		>
			<ToolkitFile workspaceId={workspaceId} />
			<Listing items={servers} empty="no mcp servers yet">
				{(entry) => (
					<McpFile key={entry.server} workspaceId={workspaceId} entry={entry} />
				)}
			</Listing>
		</TreeFolder>
	);
}

const LABELS: Record<McpAction, [idle: string, busy: string]> = {
	start: ["start", "starting…"],
	login: ["log in", "opening…"],
	logout: ["log out", "logging out…"],
	remove: ["delete", "deleting…"],
};

function ActionButton({
	action,
	busy,
	disabled,
	onRun,
}: {
	action: McpAction;
	busy: McpAction | null;
	disabled: boolean;
	onRun: () => void;
}) {
	const [idle, running] = LABELS[action];
	return (
		<Button
			size="sm"
			variant={action === "remove" ? "destructive" : "outline"}
			disabled={busy !== null || disabled}
			onClick={onRun}
		>
			{busy === action ? running : idle}
		</Button>
	);
}

type StartState = "starting" | "started" | undefined;

function startState(phase: McpPhase | undefined): StartState {
	if (phase === "ready") return "started";
	if (phase === "starting") return "starting";
	return undefined;
}

function StartButton({
	state,
	busy,
	run,
}: {
	state: StartState;
	busy: McpAction | null;
	run: (action: McpAction) => Promise<void>;
}) {
	if (state === undefined)
		return (
			<ActionButton
				action="start"
				busy={busy}
				disabled={false}
				onRun={() => void run("start")}
			/>
		);
	return (
		<Button size="sm" variant="outline" disabled>
			{state === "started" ? "started" : LABELS.start[1]}
		</Button>
	);
}

function SignInButton({
	entry,
	signedIn,
	busy,
	run,
}: {
	entry: WorkspaceMcpServer | undefined;
	signedIn: boolean;
	busy: McpAction | null;
	run: (action: McpAction) => Promise<void>;
}) {
	if (!entry?.login) return null;
	const action = signedIn ? "logout" : "login";
	return (
		<ActionButton
			action={action}
			busy={busy}
			disabled={false}
			onRun={() => void run(action)}
		/>
	);
}

function McpActions({
	server,
	entry,
	known,
	signedIn,
	busy,
	run,
}: {
	server: string;
	entry: WorkspaceMcpServer | undefined;
	known: boolean;
	signedIn: boolean;
	busy: McpAction | null;
	run: (action: McpAction) => Promise<void>;
}) {
	const [confirming, setConfirming] = useState(false);
	return (
		<div className="flex items-center gap-1.5">
			<ConfirmDialog
				open={confirming}
				onOpenChange={setConfirming}
				title={`Delete ${server}?`}
				description="Its pod and everything it holds go with it. Loading it again starts fresh."
				confirm="delete"
				destructive
				onConfirm={() => void run("remove")}
			/>
			<StartButton state={startState(entry?.phase)} busy={busy} run={run} />
			<SignInButton entry={entry} signedIn={signedIn} busy={busy} run={run} />
			<ActionButton
				action="remove"
				busy={busy}
				disabled={!known}
				onRun={() => setConfirming(true)}
			/>
		</div>
	);
}

function fetchedText(at: number | undefined): string | undefined {
	return at === undefined
		? undefined
		: `as last read ${new Date(at).toLocaleString()}`;
}

function ToolList({ entry }: { entry: WorkspaceMcpServer }) {
	if (entry.tools.length === 0)
		return <span className="text-dim">start it once to read its tools</span>;
	return (
		<ul className="flex flex-col gap-2">
			{entry.tools.map((tool) => (
				<li key={tool.name} className="flex min-w-0 flex-col gap-0.5">
					<span className="font-mono text-[12px]">
						{entry.server}/{tool.name}
					</span>
					{tool.description !== undefined && (
						<span className="line-clamp-3 break-words text-[12px] text-dim">
							{tool.description}
						</span>
					)}
				</li>
			))}
		</ul>
	);
}

function McpServerDetail({ entry }: { entry: WorkspaceMcpServer }) {
	return (
		<div className="flex flex-col gap-4">
			<Field label="server">
				<span className="flex items-center gap-2">
					<McpLogo icon={entry.icon} />
					<span>{entry.server}</span>
				</span>
			</Field>
			{entry.description !== undefined && (
				<Field label="description">
					<p className="whitespace-pre-wrap break-words">{entry.description}</p>
				</Field>
			)}
			<Field label="status">
				<span className="flex items-center gap-2">
					<PhaseDot phase={entry.phase} />
					<span>{phaseText(entry)}</span>
				</span>
			</Field>
			<Field label="mounted">
				{entry.mounted ? "loaded in this workspace" : "not loaded"}
			</Field>
			<Field label="tools" hint={fetchedText(entry.fetchedAt)}>
				<ToolList entry={entry} />
			</Field>
		</div>
	);
}

function McpServerBody({
	server,
	loading,
	entry,
}: {
	server: string;
	loading: boolean;
	entry: WorkspaceMcpServer | undefined;
}) {
	if (entry !== undefined) return <McpServerDetail entry={entry} />;
	if (loading) return <div className="text-dim">loading…</div>;
	return <div className="text-dim">no mcp server named {server}</div>;
}

function ActionError({ error }: { error: string | null }) {
	if (error === null) return null;
	return (
		<div role="alert" className="mt-4 text-[12px] text-red">
			{error}
		</div>
	);
}

export function McpServerPage({
	workspaceId,
	server,
}: {
	workspaceId: Id<"workspaces">;
	server: string;
}) {
	const { loading, known, entry, signedIn } = useMcpServer(workspaceId, server);
	const { busy, error, run } = useMcpAction(workspaceId, server);
	return (
		<PageView
			title={`mcp/${server}`}
			actions={
				<McpActions
					server={server}
					entry={entry}
					known={known}
					signedIn={signedIn}
					busy={busy}
					run={run}
				/>
			}
		>
			<McpServerBody server={server} loading={loading} entry={entry} />
			<ActionError error={error} />
		</PageView>
	);
}

function ToolkitRow({
	workspaceId,
	entry,
	signedIn,
}: {
	workspaceId: Id<"workspaces">;
	entry: WorkspaceMcpServer;
	signedIn: boolean;
}) {
	const { busy, error, run } = useMcpAction(workspaceId, entry.server);
	return (
		<li className="flex flex-col gap-1.5 border-bg2 border-t pt-3">
			<div className="flex min-w-0 items-center gap-2">
				<McpLogo icon={entry.icon} />
				<button
					type="button"
					onClick={() => requestPanel(mcpPage(entry.server))}
					className="min-w-0 flex-1 cursor-pointer truncate text-left text-fg hover:underline"
				>
					{entry.server}
				</button>
				<PhaseDot phase={entry.phase} />
				<StartButton state={startState(entry.phase)} busy={busy} run={run} />
				<SignInButton entry={entry} signedIn={signedIn} busy={busy} run={run} />
			</div>
			{entry.description !== undefined && (
				<p className="line-clamp-3 break-words text-[12px] text-dim">
					{entry.description}
				</p>
			)}
			<ActionError error={error} />
		</li>
	);
}

export function ToolkitPage({
	workspaceId,
}: {
	workspaceId: Id<"workspaces">;
}) {
	const servers = useWorkspaceMcpServers(workspaceId);
	const toolkit = useToolkit();
	const signedIn = useSignedIn(workspaceId);
	const rows = toolkit?.map((listed) => ({
		entry:
			withToolkit(
				servers?.find((found) => found.server === listed.server),
				listed,
			) ?? fromToolkit(listed),
		signedIn: signedInTo(signedIn, listed.server, listed),
	}));
	return (
		<PageView title="mcp/toolkit">
			{rows === undefined ? (
				<div className="text-dim">loading…</div>
			) : (
				<ul className="flex flex-col gap-3">
					{rows.map(({ entry, signedIn: ready }) => (
						<ToolkitRow
							key={entry.server}
							workspaceId={workspaceId}
							entry={entry}
							signedIn={ready}
						/>
					))}
				</ul>
			)}
		</PageView>
	);
}
