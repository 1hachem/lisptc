export interface UiNode {
	tag: string;
	props: Record<string, unknown>;
	children: UiNode[];
}

export function toUiNode(value: unknown): UiNode | undefined {
	if (!value || typeof value !== "object") return undefined;
	const node = value as Partial<UiNode>;
	return typeof node.tag === "string" ? (value as UiNode) : undefined;
}

function prop(node: UiNode, key: string): string {
	const value = node.props[key];
	return typeof value === "string" ? value : "";
}

function tableText(node: UiNode): string {
	const columns = Array.isArray(node.props.columns)
		? node.props.columns.map((c) => String(c ?? ""))
		: [];
	const rows = Array.isArray(node.props.rows) ? node.props.rows : [];
	const cells = (row: unknown): string[] =>
		columns.map((column) => {
			const cell = (row as Record<string, unknown>)?.[column];
			return cell === null || cell === undefined ? "" : String(cell);
		});
	return [columns, ...rows.map(cells)]
		.map((line) => `| ${line.join(" | ")} |`)
		.join("\n");
}

export function viewText(node: UiNode): string {
	const kids = (): string =>
		node.children
			.map(viewText)
			.filter((s) => s !== "")
			.join("\n");
	switch (node.tag) {
		case "text":
		case "heading":
		case "markdown":
			return prop(node, "text");
		case "link":
			return `[${prop(node, "text") || prop(node, "href")}](${prop(node, "href")})`;
		case "badge":
			return prop(node, "text");
		case "kpi":
			return [prop(node, "label"), prop(node, "value"), prop(node, "hint")]
				.filter((s) => s !== "")
				.join(": ");
		case "card":
			return [prop(node, "title"), kids()].filter((s) => s !== "").join("\n");
		case "table":
			return tableText(node);
		case "button":
			return `[${prop(node, "label")}]`;
		case "input":
		case "select":
		case "checkbox":
			return prop(node, "label") || prop(node, "name");
		case "form":
			return [kids(), `[${prop(node, "submit") || "submit"}]`]
				.filter((s) => s !== "")
				.join("\n");
		default:
			return kids();
	}
}
