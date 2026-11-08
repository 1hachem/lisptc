import type { Id } from "@repo/backend/dataModel";
import type { McpAction } from "@repo/backend/mcp-actions";
import { TreeFile, TreeFolder } from "@repo/components";
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

function phaseText(entry: WorkspaceMcpServer): string {
	if (entry.phase === undefined) return "not running";
	return entry.reason ? `${entry.phase}: ${entry.reason}` : entry.phase;
}

function useMcpAction(workspaceId: Id<"workspaces">, server: string) {
	const [busy, setBusy] = useState<McpAction | null>(null);
	const [error, setError] = useState<string | null>(null);
	const run = async (action: McpAction) => {
		setBusy(action);
		setError(null);
		const link = action === "login" ? window.open("", "_blank") : null;
		try {
			const result = await postMcpAction(workspaceId, server, action);
			const url = "error" in result ? undefined : result.url;
			if ("error" in result) setError(result.error);
			if (link !== null) {
				if (url === undefined) link.close();
				else link.location.href = url;
			}
			if (action === "remove" && !("error" in result))
				requestPanelClosed(mcpPage(server));
		} catch (ex) {
			link?.close();
			setError(ex instanceof Error ? ex.message : String(ex));
		} finally {
			setBusy(null);
		}
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
	const running = entry?.phase === "starting" || entry?.phase === "ready";
	return (
		<PageView
			title={`mcp/${server}`}
			actions={
				<div className="flex items-center gap-1.5">
					<Button
						size="sm"
						variant="outline"
						disabled={busy !== null || running}
						onClick={() => void run("start")}
					>
						{busy === "start" ? "starting…" : "start"}
					</Button>
					<Button
						size="sm"
						variant="outline"
						disabled={busy !== null}
						onClick={() => void run("login")}
					>
						{busy === "login" ? "opening…" : "log in"}
					</Button>
					<Button
						size="sm"
						variant="destructive"
						disabled={busy !== null || entry === undefined}
						onClick={() => {
							if (window.confirm(`delete ${server} and everything it holds?`))
								void run("remove");
						}}
					>
						{busy === "remove" ? "deleting…" : "delete"}
					</Button>
				</div>
			}
		>
			{servers === undefined ? (
				<div className="text-dim">loading…</div>
			) : entry === undefined ? (
				<div className="text-dim">no mcp server named {server}</div>
			) : (
				<div className="flex flex-col gap-4">
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
			)}
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
