import { McpServerIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { Id } from "@repo/backend/dataModel";
import type { McpAction, McpActionResult } from "@repo/backend/mcp-actions";
import { ConfirmDialog, TreeFile, TreeFolder } from "@repo/components";
import { Button } from "@repo/ui";
import { useState } from "react";
import { postMcpAction } from "../lib/mcp-action.ts";
import { dragsAs, type PanelContent } from "../lib/panel-ops.ts";
import { requestPanel, requestPanelClosed } from "../lib/panel-requests.ts";
import { useWorkspace } from "../lib/workspace.tsx";
import { FileMenu } from "./file-menu.tsx";
import { PageView } from "./file-view.tsx";
import {
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
	const run = async (action: McpAction) => {
		setBusy(action);
		setError(null);
		const link = action === "login" ? window.open("", "_blank") : null;
		const result = await attempt(workspaceId, server, action);
		landLink(link, result);
		setBusy(null);
		if ("error" in result) setError(result.error);
		else if (action === "remove") requestPanelClosed(mcpPage(server));
	};
	return { busy, error, run };
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
	const { run } = useMcpAction(workspaceId, entry.server);
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
						onDelete={() => run("remove")}
					/>
				</span>
			}
			link={linkTo(workspaceId, page)}
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
			createLabel="load one from a chat"
		>
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

function McpActions({
	server,
	entry,
	busy,
	run,
}: {
	server: string;
	entry: WorkspaceMcpServer | undefined;
	busy: McpAction | null;
	run: (action: McpAction) => Promise<void>;
}) {
	const [confirming, setConfirming] = useState(false);
	const running = entry?.phase === "starting" || entry?.phase === "ready";
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
			<ActionButton
				action="start"
				busy={busy}
				disabled={running}
				onRun={() => void run("start")}
			/>
			{entry?.login && (
				<ActionButton
					action="login"
					busy={busy}
					disabled={false}
					onRun={() => void run("login")}
				/>
			)}
			<ActionButton
				action="remove"
				busy={busy}
				disabled={entry === undefined}
				onRun={() => setConfirming(true)}
			/>
		</div>
	);
}

function McpServerDetail({
	server,
	servers,
}: {
	server: string;
	servers: WorkspaceMcpServer[] | undefined;
}) {
	if (servers === undefined) return <div className="text-dim">loading…</div>;
	const entry = servers.find((found) => found.server === server);
	if (entry === undefined)
		return <div className="text-dim">no mcp server named {server}</div>;
	return (
		<div className="flex flex-col gap-4">
			<Field label="server">
				<span className="flex items-center gap-2">
					<McpLogo icon={entry.icon} />
					<span>{entry.server}</span>
				</span>
			</Field>
			<Field label="status">
				<span className="flex items-center gap-2">
					<PhaseDot phase={entry.phase} />
					<span>{phaseText(entry)}</span>
				</span>
			</Field>
			<Field label="mounted">
				{entry.mounted ? "loaded in this workspace" : "not loaded"}
			</Field>
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
	const servers = useWorkspaceMcpServers(workspaceId);
	const { busy, error, run } = useMcpAction(workspaceId, server);
	const entry = servers?.find((found) => found.server === server);
	return (
		<PageView
			title={`mcp/${server}`}
			actions={
				<McpActions server={server} entry={entry} busy={busy} run={run} />
			}
		>
			<McpServerDetail server={server} servers={servers} />
			{error !== null && (
				<div role="alert" className="mt-4 text-[12px] text-red">
					{error}
				</div>
			)}
		</PageView>
	);
}

function WorkspaceMcpStatus({
	workspaceId,
}: {
	workspaceId: Id<"workspaces">;
}) {
	const servers = useWorkspaceMcpServers(workspaceId);
	if (servers === undefined || servers.length === 0) return null;
	return (
		<ul
			aria-label="workspace MCP servers"
			className="flex h-full flex-none items-center gap-2.5 px-2.5"
		>
			{servers.map((entry) => (
				<li key={entry.server}>
					<button
						type="button"
						title={phaseText(entry)}
						onClick={() => requestPanel(mcpPage(entry.server))}
						className="flex cursor-pointer items-center gap-1.5 hover:text-fg"
					>
						<PhaseDot phase={entry.phase} />
						<span>{entry.server}</span>
					</button>
				</li>
			))}
		</ul>
	);
}

export function McpStatus() {
	const { workspace } = useWorkspace();
	return workspace ? <WorkspaceMcpStatus workspaceId={workspace._id} /> : null;
}
