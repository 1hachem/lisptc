import type { ViewNode } from "@repo/interpreter/annotations";
import { viewKey } from "@repo/interpreter/annotations";
import { type ReactNode, useState } from "react";
import { reportIssue } from "../lib/analytics.tsx";
import { useChatSession } from "../lib/chat.tsx";
import { startPanelDrag, toPanelOps } from "../lib/panel-ops.ts";
import { usePanels } from "../lib/panels.tsx";
import { postUiAction } from "../lib/ui-action.ts";
import { Markdown } from "./markdown.tsx";

function text(props: Record<string, unknown>, key: string): string {
	const value = props[key];
	return typeof value === "string" ? value : "";
}

function strings(props: Record<string, unknown>, key: string): string[] {
	const value = props[key];
	return Array.isArray(value) ? value.map((v) => String(v ?? "")) : [];
}

type FieldValue = string | boolean;

function formValues(el: HTMLElement): Record<string, FieldValue> {
	const form = el.closest("form");
	if (!form) return {};
	const out: Record<string, FieldValue> = {};
	for (const [name, value] of new FormData(form).entries())
		out[name] = String(value);
	for (const box of form.querySelectorAll<HTMLInputElement>(
		'input[type="checkbox"]',
	))
		if (box.name) out[box.name] = box.checked;
	return out;
}

function controlValues(
	el: HTMLInputElement | HTMLSelectElement,
): Record<string, FieldValue> {
	const out = formValues(el);
	if (el.name)
		out[el.name] =
			el instanceof HTMLInputElement && el.type === "checkbox"
				? el.checked
				: el.value;
	return out;
}

type Fire = (action: string, values: Record<string, FieldValue>) => void;

const TONE_CLASSES: Record<string, string> = {
	ok: "border-green/50 text-green",
	warn: "border-yellow/50 text-yellow",
	bad: "border-red/50 text-red",
	info: "border-blue/50 text-blue",
	muted: "border-dim/50 text-dim",
};

function changed(
	node: ViewNode,
	fire: Fire,
	el: HTMLInputElement | HTMLSelectElement,
): void {
	const action = text(node.props, "on-change");
	if (action) fire(action, controlValues(el));
}

type WidgetProps = {
	node: ViewNode;
	kids: ReactNode;
	fire: Fire;
	busy: boolean;
};

const BUTTON =
	"border border-dim/50 px-2 py-px text-fg hover:border-accent hover:text-accent disabled:opacity-40";

function FieldLabel({
	node,
	className = "text-dim",
}: {
	node: ViewNode;
	className?: string;
}) {
	if (node.props.label === undefined) return null;
	return <span className={className}>{text(node.props, "label")}</span>;
}

function Link({ node }: WidgetProps) {
	return (
		<a
			href={text(node.props, "href")}
			target="_blank"
			rel="noreferrer"
			className="text-accent underline decoration-dim/50 hover:decoration-accent"
		>
			{text(node.props, "text") || text(node.props, "href")}
		</a>
	);
}

function FileLink({ node }: WidgetProps) {
	const { openFile } = usePanels();
	const folder = text(node.props, "folder");
	const name = text(node.props, "name");
	if (folder !== "knowledge" && folder !== "attachments")
		return <span className="text-dim">{text(node.props, "text") || name}</span>;
	return (
		<button
			type="button"
			title={`${folder}/${name}`}
			draggable
			onDragStart={(event) =>
				startPanelDrag(event.dataTransfer, { kind: "file", folder, name })
			}
			onClick={() => openFile(folder, name)}
			className="w-fit cursor-pointer text-left text-accent underline decoration-dim/50 hover:decoration-accent"
		>
			{text(node.props, "text") || name}
		</button>
	);
}

function Badge({ node }: WidgetProps) {
	const tone =
		TONE_CLASSES[text(node.props, "tone")] ?? "border-dim/50 text-dim";
	return (
		<span className={`w-fit border px-1 ${tone}`}>
			{text(node.props, "text")}
		</span>
	);
}

function Kpi({ node }: WidgetProps) {
	return (
		<div className="flex min-w-0 flex-col">
			<span className="text-dim">{text(node.props, "label")}</span>
			<span className="font-bold text-2xl text-fg leading-tight">
				{text(node.props, "value")}
			</span>
			{node.props.hint !== undefined && (
				<span className="text-dim">{text(node.props, "hint")}</span>
			)}
		</div>
	);
}

function Button({ node, fire, busy }: WidgetProps) {
	return (
		<button
			type="button"
			disabled={busy}
			onClick={(e) =>
				fire(text(node.props, "action"), formValues(e.currentTarget))
			}
			className={BUTTON}
		>
			{text(node.props, "label")}
		</button>
	);
}

function Input({ node, busy }: WidgetProps) {
	return (
		<label className="flex min-w-0 flex-col gap-px">
			<FieldLabel node={node} />
			<input
				name={text(node.props, "name")}
				defaultValue={text(node.props, "value")}
				placeholder={text(node.props, "placeholder")}
				disabled={busy}
				className="border border-dim/50 bg-transparent px-2 py-px text-fg outline-none placeholder:text-dim/60 focus:border-accent"
			/>
		</label>
	);
}

function Select({ node, fire, busy }: WidgetProps) {
	return (
		<label className="flex min-w-0 flex-col gap-px">
			<FieldLabel node={node} />
			<select
				name={text(node.props, "name")}
				defaultValue={text(node.props, "value")}
				disabled={busy}
				onChange={(e) => changed(node, fire, e.currentTarget)}
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
}

function Checkbox({ node, fire, busy }: WidgetProps) {
	return (
		<label className="flex min-w-0 items-center gap-2">
			<input
				type="checkbox"
				name={text(node.props, "name")}
				defaultChecked={node.props.checked === true}
				disabled={busy}
				onChange={(e) => changed(node, fire, e.currentTarget)}
			/>
			<FieldLabel node={node} className="text-fg" />
		</label>
	);
}

function Form({ node, kids, fire, busy }: WidgetProps) {
	return (
		<form
			onSubmit={(e) => {
				e.preventDefault();
				fire(text(node.props, "action"), formValues(e.currentTarget));
			}}
			className="flex min-w-0 flex-col items-start gap-2"
		>
			{kids}
			<button type="submit" disabled={busy} className={BUTTON}>
				{text(node.props, "submit") || "submit"}
			</button>
		</form>
	);
}

const WIDGETS = new Map<string, (props: WidgetProps) => ReactNode>([
	[
		"stack",
		({ kids }) => <div className="flex min-w-0 flex-col gap-2">{kids}</div>,
	],
	[
		"row",
		({ kids }) => (
			<div className="flex min-w-0 flex-wrap items-end gap-3">{kids}</div>
		),
	],
	[
		"card",
		({ node, kids }) => (
			<div className="flex min-w-0 flex-col gap-2 border border-dim/40 p-2">
				<div className="font-bold text-accent">{text(node.props, "title")}</div>
				{kids}
			</div>
		),
	],
	[
		"heading",
		({ node }) => (
			<div className="font-bold text-accent">{text(node.props, "text")}</div>
		),
	],
	[
		"text",
		({ node }) => (
			<div className="whitespace-pre-wrap break-words">
				{text(node.props, "text")}
			</div>
		),
	],
	["markdown", ({ node }) => <Markdown>{text(node.props, "text")}</Markdown>],
	["link", Link],
	["file-link", FileLink],
	["badge", Badge],
	["kpi", Kpi],
	["button", Button],
	["input", Input],
	["select", Select],
	["checkbox", Checkbox],
	["form", Form],
	["table", ({ node }) => <Table node={node} />],
]);

function Unknown({ node }: WidgetProps) {
	return <div className="text-yellow">unknown widget: {node.tag}</div>;
}

function Node({
	node,
	fire,
	busy,
}: {
	node: ViewNode;
	fire: Fire;
	busy: boolean;
}) {
	const kids = node.children.map((child, i) => (
		// biome-ignore lint/suspicious/noArrayIndexKey: no stable id in the tree
		<Node key={i} node={child} fire={fire} busy={busy} />
	));
	const Widget = WIDGETS.get(node.tag) ?? Unknown;
	return <Widget node={node} kids={kids} fire={fire} busy={busy} />;
}

function Table({ node }: { node: ViewNode }) {
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

export function GenerativeUI({ node }: { node: ViewNode }) {
	const { chatId, send } = useChatSession((state) => ({
		chatId: state.chatId,
		send: state.send,
	}));
	const { apply } = usePanels();
	const [ui, setUi] = useState(node);
	const [output, setOutput] = useState("");
	const [failed, setFailed] = useState(false);
	const [busy, setBusy] = useState(false);

	const fire: Fire = (action, values) => {
		if (!action || busy) return;
		setBusy(true);
		void (async () => {
			try {
				const result = await postUiAction(chatId, action, values);
				if (!result.live) {
					setFailed(true);
					setOutput("this view is no longer live — ask again to rebuild it");
					return;
				}
				const data = result.response;
				const next = viewKey.schema.safeParse(data.ui).data;
				if (next) setUi(next);
				apply(toPanelOps(data.panel));
				setOutput(typeof data.output === "string" ? data.output : "");
				setFailed(Boolean(data.error));
				if (data.message) void send(data.message);
			} catch (ex) {
				reportIssue(ex, { $exception_source: "ui action" });
				setFailed(true);
				setOutput(ex instanceof Error ? ex.message : String(ex));
			} finally {
				setBusy(false);
			}
		})();
	};

	return (
		<div className="min-w-0 border-accent/40 border-l pl-3">
			<Node node={ui} fire={fire} busy={busy} />
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
