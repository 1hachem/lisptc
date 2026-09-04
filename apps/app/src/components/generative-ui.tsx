/**
 * Drawing what the agent rendered, and driving it.
 *
 * A step that called `(ui/render …)` sends its widget tree along with the
 * REPL's text output (`additional_kwargs.ui`). The tree is data: tags, props,
 * and — where a button or a form was — an opaque `action` id standing in for a
 * Lisp closure that never left the server.
 *
 * Pressing one posts that id back to `/api/ui-action`, where it runs in the
 * thread's live interpreter and answers with a new tree, which replaces this one
 * in place. No model turn happens, so the exchange costs nothing and leaves no
 * mark on the transcript: what the reader sees change is the widget, not the
 * conversation.
 *
 * Unless the handler called `ui/send`. Then the reply also carries a `message`,
 * which goes into the composer's own `send` — so it lands in the transcript as a
 * user turn and the agent answers it, exactly as if the reader had typed it. That
 * is the one path by which a click costs a model turn, and the handler chose it.
 *
 * Field values ride on the native form. Each `ui/input` is an uncontrolled
 * `<input name=…>` inside a real `<form>`, so "the fields of the form this
 * control is in" is answered by `FormData` rather than by state we would have to
 * keep in step with a tree the server keeps replacing.
 */

import { useState } from "react";
import { API_URL, apiHeaders } from "../lib/api.ts";
import { useChatSession } from "../lib/chat.tsx";
import { Markdown } from "./markdown.tsx";

export interface UiNode {
	tag: string;
	props: Record<string, unknown>;
	children: UiNode[];
}

/** A tool message's `ui` payload, or undefined if the step rendered nothing. */
export function toUiNode(value: unknown): UiNode | undefined {
	if (!value || typeof value !== "object") return undefined;
	const node = value as Partial<UiNode>;
	return typeof node.tag === "string" ? (value as UiNode) : undefined;
}

interface ActionResponse {
	output?: string;
	error?: boolean;
	view?: unknown;
	/** a `ui/send` from the handler: post it as a user turn */
	message?: string;
}

function text(props: Record<string, unknown>, key: string): string {
	const value = props[key];
	return typeof value === "string" ? value : "";
}

function strings(props: Record<string, unknown>, key: string): string[] {
	const value = props[key];
	return Array.isArray(value) ? value.map((v) => String(v ?? "")) : [];
}

// The fields of the form this control sits in, empty for a control outside one.
function formValues(el: HTMLElement): Record<string, string> {
	const form = el.closest("form");
	if (!form) return {};
	const out: Record<string, string> = {};
	for (const [name, value] of new FormData(form).entries())
		out[name] = String(value);
	return out;
}

type Fire = (action: string, values: Record<string, string>) => void;

function Node({
	node,
	fire,
	busy,
}: {
	node: UiNode;
	fire: Fire;
	busy: boolean;
}) {
	const kids = node.children.map((child, i) => (
		// Position is the only identity a widget tree has: the server rebuilds it
		// whole on every render, so there is no stable id to key on.
		// biome-ignore lint/suspicious/noArrayIndexKey: no stable id in the tree
		<Node key={i} node={child} fire={fire} busy={busy} />
	));

	switch (node.tag) {
		case "stack":
			return <div className="flex min-w-0 flex-col gap-2">{kids}</div>;
		case "row":
			return (
				<div className="flex min-w-0 flex-wrap items-end gap-3">{kids}</div>
			);
		case "heading":
			return (
				<div className="font-bold text-accent">{text(node.props, "text")}</div>
			);
		case "text":
			return (
				<div className="whitespace-pre-wrap break-words">
					{text(node.props, "text")}
				</div>
			);
		case "markdown":
			return <Markdown>{text(node.props, "text")}</Markdown>;
		case "button":
			return (
				<button
					type="button"
					disabled={busy}
					onClick={(e) =>
						fire(text(node.props, "action"), formValues(e.currentTarget))
					}
					className="border border-dim/50 px-2 py-px text-fg hover:border-accent hover:text-accent disabled:opacity-40"
				>
					{text(node.props, "label")}
				</button>
			);
		case "input":
			return (
				<label className="flex min-w-0 flex-col gap-px">
					{node.props.label !== undefined && (
						<span className="text-dim">{text(node.props, "label")}</span>
					)}
					<input
						name={text(node.props, "name")}
						defaultValue={text(node.props, "value")}
						placeholder={text(node.props, "placeholder")}
						disabled={busy}
						className="border border-dim/50 bg-transparent px-2 py-px text-fg outline-none placeholder:text-dim/60 focus:border-accent"
					/>
				</label>
			);
		case "select":
			return (
				<label className="flex min-w-0 flex-col gap-px">
					{node.props.label !== undefined && (
						<span className="text-dim">{text(node.props, "label")}</span>
					)}
					<select
						name={text(node.props, "name")}
						defaultValue={text(node.props, "value")}
						disabled={busy}
						className="border border-dim/50 bg-bg px-2 py-px text-fg outline-none focus:border-accent"
					>
						{strings(node.props, "options").map((option) => (
							<option key={option} value={option}>
								{option}
							</option>
						))}
					</select>
				</label>
			);
		case "form":
			return (
				<form
					onSubmit={(e) => {
						e.preventDefault();
						fire(
							text(node.props, "action"),
							formValues(e.currentTarget as HTMLElement),
						);
					}}
					className="flex min-w-0 flex-col items-start gap-2"
				>
					{kids}
					<button
						type="submit"
						disabled={busy}
						className="border border-dim/50 px-2 py-px text-fg hover:border-accent hover:text-accent disabled:opacity-40"
					>
						{text(node.props, "submit") || "submit"}
					</button>
				</form>
			);
		case "table":
			return <Table node={node} />;
		default:
			return <div className="text-yellow">unknown widget: {node.tag}</div>;
	}
}

function Table({ node }: { node: UiNode }) {
	const columns = strings(node.props, "columns");
	const rows = Array.isArray(node.props.rows) ? node.props.rows : [];
	return (
		<div className="min-w-0 overflow-x-auto">
			<table className="w-full text-left">
				<thead>
					<tr className="border-dim/40 border-b text-dim">
						{columns.map((column) => (
							<th key={column} className="pr-4 pb-px font-normal">
								{column}
							</th>
						))}
					</tr>
				</thead>
				<tbody>
					{rows.map((row, i) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: rows carry no id
						<tr key={i} className="align-top">
							{columns.map((column) => {
								const cell = (row as Record<string, unknown>)?.[column];
								return (
									<td key={column} className="pr-4">
										{cell === null || cell === undefined ? "" : String(cell)}
									</td>
								);
							})}
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

export function GenerativeUI({ node }: { node: UiNode }) {
	const { threadId, send } = useChatSession();
	// The tree the server last sent. Seeded from the message and then owned
	// locally, because every click answers with a whole new one.
	const [view, setView] = useState(node);
	const [output, setOutput] = useState("");
	const [failed, setFailed] = useState(false);
	const [busy, setBusy] = useState(false);

	const fire: Fire = (action, values) => {
		if (!action || busy) return;
		setBusy(true);
		void (async () => {
			try {
				const res = await fetch(`${API_URL}/api/ui-action`, {
					method: "POST",
					headers: apiHeaders(),
					body: JSON.stringify({ thread_id: threadId, action, values }),
				});
				if (res.status === 409) {
					setFailed(true);
					setOutput("this view is no longer live — ask again to rebuild it");
					return;
				}
				const data = (await res.json()) as ActionResponse;
				const next = toUiNode(data.view);
				if (next) setView(next);
				setOutput(typeof data.output === "string" ? data.output : "");
				setFailed(Boolean(data.error));
				// After the view, so the transcript grows under a widget already
				// showing whatever the handler rendered on its way out.
				if (data.message) send(data.message);
			} catch (ex) {
				setFailed(true);
				setOutput(ex instanceof Error ? ex.message : String(ex));
			} finally {
				setBusy(false);
			}
		})();
	};

	return (
		<div className="min-w-0 border-accent/40 border-l pl-3">
			<Node node={view} fire={fire} busy={busy} />
			{output && (
				<div
					className={`mt-2 whitespace-pre-wrap break-words ${failed ? "text-red" : "text-dim"}`}
				>
					{output}
				</div>
			)}
		</div>
	);
}
