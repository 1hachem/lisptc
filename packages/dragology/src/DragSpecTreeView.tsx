import { createContext, useContext } from "react";
import type { Vec2 } from "./math/vec2";
import type { Operator } from "./op";
import { StudioHackContext } from "./studio/StudioHackContext";
import { drawLayered, type LayeredSvgx } from "./svgx/layers";
import type { Transition } from "./transition";
import { assert } from "./utils/assert";

export type DragSpecTreeViewNodeProps = {
	width?: number | string;
	height?: number | string;
};

type TreeViewContext = {
	activePath: string;
	colorMap: Map<string, string> | null;
	nodeProps: Record<string, DragSpecTreeViewNodeProps> | undefined;
	svgWidth: number;
	svgHeight: number;
	thumbArea: number;
};

const TreeViewContext = createContext<TreeViewContext | null>(null);

function useTreeViewContext() {
	const ctx = useContext(TreeViewContext);
	assert(ctx !== null, "TreeViewContext not initialized");
	return ctx;
}

const ACTIVE_BG = "rgba(250, 204, 21, 0.25)";
const ACTIVE_BORDER = "rgb(250, 204, 21)";
const INACTIVE_BG = "rgba(148, 163, 184, 0.08)";
const INACTIVE_BORDER = "rgb(203, 213, 225)";

export function SpecNode<T extends object>({
	op,
	path,
}: {
	op: Operator<T>;
	path: string;
}) {
	const { activePath, colorMap } = useTreeViewContext();
	const fullPath = path + op.name;
	return op.treeView({
		path,
		childPath: fullPath + "/",
		active: activePath === fullPath || activePath.startsWith(fullPath + "/"),
		color: colorMap?.get(fullPath),
	});
}

export type RenderedState = { layered: LayeredSvgx; position: Vec2 };

export function StateThumbnails({
	renderedStates,
	closestIndex,
}: {
	renderedStates: RenderedState[];
	closestIndex?: number;
}) {
	const { svgWidth, svgHeight, thumbArea } = useTreeViewContext();
	if (svgWidth === 0 || svgHeight === 0) return null;
	const aspect = svgWidth / svgHeight;
	const h = Math.round(Math.sqrt(thumbArea / aspect));
	const w = Math.round(h * aspect);
	return (
		<div
			style={{
				display: "flex",
				flexDirection: "row",
				gap: 3,
				flexWrap: "wrap",
				marginTop: 2,
			}}
		>
			{renderedStates.map((rs, i) => (
				<svg
					key={i}
					width={w}
					height={h}
					viewBox={`0 0 ${svgWidth} ${svgHeight}`}
					style={{
						border: "1px solid rgb(203, 213, 225)",
						borderRadius: 3,
						background: "white",
						transition: "width 150ms ease, height 150ms ease",
						...(closestIndex === i
							? { outline: `2px solid ${ACTIVE_BORDER}`, outlineOffset: -1 }
							: {}),
					}}
				>
					{drawLayered(rs.layered)}
				</svg>
			))}
		</div>
	);
}

export function OutputThumbnail({
	outputPreview,
	active,
}: {
	outputPreview: LayeredSvgx;
	active?: boolean;
}) {
	const { svgWidth, svgHeight, thumbArea } = useTreeViewContext();
	if (svgWidth === 0 || svgHeight === 0) return null;
	const aspect = svgWidth / svgHeight;
	const h = Math.round(Math.sqrt(thumbArea / aspect));
	const w = Math.round(h * aspect);
	return (
		<div style={{ marginTop: 2, marginBottom: 4 }}>
			<svg
				width={w}
				height={h}
				viewBox={`0 0 ${svgWidth} ${svgHeight}`}
				style={{
					border: "1px solid rgb(203, 213, 225)",
					borderRadius: 3,
					background: "white",
					transition: "width 150ms ease, height 150ms ease",
					...(active
						? { outline: `2px solid ${ACTIVE_BORDER}`, outlineOffset: -1 }
						: {}),
				}}
			>
				{active && (
					<rect
						width={svgWidth}
						height={svgHeight}
						fill={ACTIVE_BORDER}
						opacity={0.15}
					/>
				)}
				{drawLayered(outputPreview)}
			</svg>
		</div>
	);
}

export function Box({
	label,
	active,
	color,
	path,
	children,
}: {
	label: string;
	active?: boolean;
	color?: string;
	path?: string;
	children?: React.ReactNode;
}) {
	const { nodeProps } = useTreeViewContext();
	const { tightFixed } = useContext(StudioHackContext);
	const myProps = path !== undefined ? nodeProps?.[path] : undefined;

	const bg = color
		? colorToAlpha(color, 0.15)
		: active
			? ACTIVE_BG
			: INACTIVE_BG;
	const border = color ? color : active ? ACTIVE_BORDER : INACTIVE_BORDER;

	return (
		<div
			style={{
				width: myProps?.width ?? "fit-content",
				height: myProps?.height,
				background: bg,
				border: `1px solid ${border}`,
				borderRadius: 6,
				padding: "4px 6px",
				transition: "background 150ms, border-color 150ms",
				...(active
					? color
						? { outline: `2px solid black`, outlineOffset: 1 }
						: { outline: `2px solid ${ACTIVE_BORDER}`, outlineOffset: -1 }
					: {}),
			}}
		>
			<div
				style={{
					color: active && !color ? "rgb(161, 98, 7)" : "rgb(100, 116, 139)",
					fontWeight: active ? 600 : 400,
					marginBottom: children ? 3 : 0,
					fontSize: tightFixed ? 15 : 10,
				}}
			>
				{label}
			</div>
			{children}
		</div>
	);
}

export function Slot({
	label,
	children,
}: {
	label: string;
	children: React.ReactNode;
}) {
	return (
		<div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
			<div style={{ fontSize: 9, color: "rgb(148, 163, 184)", paddingLeft: 2 }}>
				{label}
			</div>
			{children}
		</div>
	);
}

export function describeTransition(t: Transition | false): string {
	if (!t) return "none";
	return `${typeof t.easing === "function" ? "fn" : t.easing} ${t.duration}ms`;
}

export function truncate(s: string, maxLen: number): string {
	return s.length <= maxLen ? s : s.slice(0, maxLen - 1) + "\u2026";
}

function colorToAlpha(rgb: string, alpha: number): string {
	const match = rgb.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
	if (!match) return rgb;
	return `rgba(${match[1]}, ${match[2]}, ${match[3]}, ${alpha})`;
}
