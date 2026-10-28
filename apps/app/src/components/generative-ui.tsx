import { convexQuery } from "@convex-dev/react-query";
import { api } from "@repo/backend/api";
import type { Id } from "@repo/backend/dataModel";
import { type PropsOf, type Tag, widgetOf } from "@repo/ui-catalog";
import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { reportIssue } from "../lib/analytics.tsx";
import { useChatSession } from "../lib/chat.tsx";
import { startPanelDrag } from "../lib/panel-ops.ts";
import { usePanels } from "../lib/panels.tsx";
import { postUiAction } from "../lib/ui-action.ts";
import { type ViewNode, viewNode } from "../lib/ui-node.ts";
import { Markdown } from "./markdown.tsx";

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

const TONE_CLASSES: Record<NonNullable<PropsOf<"badge">["tone"]>, string> = {
	ok: "border-green/50 text-green",
	warn: "border-yellow/50 text-yellow",
	bad: "border-red/50 text-red",
	info: "border-blue/50 text-blue",
	muted: "border-dim/50 text-dim",
};

function changed(
	action: string | undefined,
	fire: Fire,
	el: HTMLInputElement | HTMLSelectElement,
): void {
	if (action) fire(action, controlValues(el));
}

type WidgetProps<T extends Tag> = {
	props: PropsOf<T>;
	kids: ReactNode;
	fire: Fire;
	busy: boolean;
};

type Renderers = { [T in Tag]: (props: WidgetProps<T>) => ReactNode };

const BUTTON =
	"border border-dim/50 px-2 py-px text-fg hover:border-accent hover:text-accent disabled:opacity-40";

function FieldLabel({
	label,
	className = "text-dim",
}: {
	label: string | undefined;
	className?: string;
}) {
	if (label === undefined) return null;
	return <span className={className}>{label}</span>;
}

function FileLink({ props }: WidgetProps<"file-link">) {
	const { openFile } = usePanels();
	const { folder, name } = props;
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
			{props.text || name}
		</button>
	);
}

function Table({ props }: WidgetProps<"table">) {
	const { columns, rows } = props;
	return (
		<div className="min-w-0 overflow-x-auto">
			<table className="w-max min-w-full text-left">
				<thead>
					<tr className="border-dim/40 border-b text-dim">
						{columns.map((column) => (
							<th key={column} className="pr-4 pb-px font-normal">
								<div className="max-w-80 wrap-anywhere">{column}</div>
							</th>
						))}
					</tr>
				</thead>
				<tbody>
					{rows.map((row, i) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: rows carry no id
						<tr key={i} className="align-top">
							{columns.map((column) => {
								const cell =
									row !== null && typeof row === "object" && !Array.isArray(row)
										? row[column]
										: undefined;
								return (
									<td key={column} className="pr-4">
										<div className="max-w-80 wrap-anywhere">
											{cell === null || cell === undefined ? "" : String(cell)}
										</div>
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

const WIDGETS: Renderers = {
	stack: ({ kids }) => (
		<div className="flex min-w-0 flex-col gap-2">{kids}</div>
	),
	row: ({ kids }) => (
		<div className="flex min-w-0 flex-wrap items-end gap-3">{kids}</div>
	),
	card: ({ props, kids }) => (
		<div className="flex min-w-0 flex-col gap-2 border border-dim/40 p-2">
			<div className="font-bold text-accent">{props.title}</div>
			{kids}
		</div>
	),
	heading: ({ props }) => (
		<div className="font-bold text-accent">{props.text}</div>
	),
	text: ({ props }) => (
		<div className="whitespace-pre-wrap break-words">{props.text}</div>
	),
	markdown: ({ props }) => <Markdown>{props.text}</Markdown>,
	link: ({ props }) => (
		<a
			href={props.href}
			target="_blank"
			rel="noreferrer"
			className="text-accent underline decoration-dim/50 hover:decoration-accent"
		>
			{props.text || props.href}
		</a>
	),
	"file-link": FileLink,
	badge: ({ props }) => (
		<span
			className={`w-fit border px-1 ${props.tone ? TONE_CLASSES[props.tone] : "border-dim/50 text-dim"}`}
		>
			{props.text}
		</span>
	),
	kpi: ({ props }) => (
		<div className="flex min-w-0 flex-col">
			<span className="text-dim">{props.label}</span>
			<span className="font-bold text-2xl text-fg leading-tight">
				{props.value}
			</span>
			{props.hint !== undefined && (
				<span className="text-dim">{props.hint}</span>
			)}
		</div>
	),
	button: ({ props, fire, busy }) => (
		<button
			type="button"
			disabled={busy}
			onClick={(e) => fire(props.action, formValues(e.currentTarget))}
			className={BUTTON}
		>
			{props.label}
		</button>
	),
	input: ({ props, busy }) => (
		<label className="flex min-w-0 flex-col gap-px">
			<FieldLabel label={props.label} />
			<input
				name={props.name}
				defaultValue={props.value ?? ""}
				placeholder={props.placeholder ?? ""}
				disabled={busy}
				className="border border-dim/50 bg-transparent px-2 py-px text-fg outline-none placeholder:text-dim/60 focus:border-accent"
			/>
		</label>
	),
	select: ({ props, fire, busy }) => (
		<label className="flex min-w-0 flex-col gap-px">
			<FieldLabel label={props.label} />
			<select
				name={props.name}
				defaultValue={props.value ?? ""}
				disabled={busy}
				onChange={(e) => changed(props["on-change"], fire, e.currentTarget)}
				className="border border-dim/50 bg-bg px-2 py-px text-fg outline-none focus:border-accent"
			>
				{props.options.map((option) => (
					<option key={option} value={option}>
						{option}
					</option>
				))}
			</select>
		</label>
	),
	checkbox: ({ props, fire, busy }) => (
		<label className="flex min-w-0 items-center gap-2">
			<input
				type="checkbox"
				name={props.name}
				defaultChecked={props.checked === true}
				disabled={busy}
				onChange={(e) => changed(props["on-change"], fire, e.currentTarget)}
			/>
			<FieldLabel label={props.label} className="text-fg" />
		</label>
	),
	form: ({ props, kids, fire, busy }) => (
		<form
			onSubmit={(e) => {
				e.preventDefault();
				fire(props.action, formValues(e.currentTarget));
			}}
			className="flex min-w-0 flex-col items-start gap-2"
		>
			{kids}
			<button type="submit" disabled={busy} className={BUTTON}>
				{props.submit || "submit"}
			</button>
		</form>
	),
	table: Table,
};

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
	const widget = widgetOf(node);
	if (widget === undefined)
		return <div className="text-yellow">unknown widget: {node.tag}</div>;
	const Widget = WIDGETS[widget.tag] as (props: WidgetProps<Tag>) => ReactNode;
	return <Widget props={widget.props} kids={kids} fire={fire} busy={busy} />;
}

export function GenerativeUI({
	chatId,
	viewId,
}: {
	chatId: Id<"chats">;
	viewId: string;
}) {
	const { data } = useQuery(convexQuery(api.views.get, { chatId, viewId }));
	const node = viewNode.safeParse(data?.node).data;
	if (node === undefined) return null;
	return <View chatId={chatId} node={node} />;
}

export function View({
	chatId,
	node,
}: {
	chatId: Id<"chats">;
	node: ViewNode;
}) {
	const send = useChatSession((state) => state.send);
	const [output, setOutput] = useState("");
	const [failed, setFailed] = useState(false);
	const [busy, setBusy] = useState(false);

	const fire: Fire = (action, values) => {
		if (!action || busy) return;
		setBusy(true);
		void (async () => {
			try {
				const data = await postUiAction(chatId, action, values);
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
			<Node node={node} fire={fire} busy={busy} />
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
