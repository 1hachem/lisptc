import {
	ArrowDown01Icon,
	ArrowUp01Icon,
	Cancel01Icon,
	Maximize01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { Tab } from "@repo/components";
import { type ReactNode, type SyntheticEvent, useState } from "react";
import { type PanelContent, tabLabel } from "../lib/panel-ops.ts";
import { usePanels } from "../lib/panels.tsx";
import { useStatusBarOrder } from "../lib/status-bar.ts";
import { PanelTab } from "./panel-tab.tsx";
import { StatusBar } from "./status-bar.tsx";

const WINDOW_BUTTON =
	"flex h-full flex-none cursor-pointer items-center px-1.5 text-dim hover:text-fg";

const keepFromBarDrag = (event: SyntheticEvent) => event.stopPropagation();

function MinimizedWindow({
	tab,
	open,
	onToggle,
}: {
	tab: Tab<PanelContent>;
	open: boolean;
	onToggle: () => void;
}) {
	const { restore, dismiss } = usePanels();
	const label = tabLabel(tab.content);
	return (
		<section
			aria-label={label}
			onKeyDown={keepFromBarDrag}
			className={`relative flex h-full w-72 flex-none items-center border-sidebar border-l last:border-r ${open ? "bg-bg text-fg" : "hover:bg-bg2"}`}
		>
			<button
				type="button"
				aria-expanded={open}
				title={open ? `collapse ${label}` : `open ${label}`}
				onClick={onToggle}
				className="flex h-full min-w-0 flex-1 cursor-pointer items-center gap-1.5 pl-2.5 text-left"
			>
				<span className="truncate">{label}</span>
				<HugeiconsIcon
					className="size-icon-xs flex-none text-dim"
					icon={open ? ArrowDown01Icon : ArrowUp01Icon}
				/>
			</button>
			<button
				type="button"
				aria-label={`put ${label} back in the layout`}
				title="maximize"
				onClick={() => restore(tab.id)}
				className={WINDOW_BUTTON}
			>
				<HugeiconsIcon className="size-icon-xs" icon={Maximize01Icon} />
			</button>
			<button
				type="button"
				aria-label={`close ${label}`}
				title="close"
				onClick={() => dismiss(tab.id)}
				className={`${WINDOW_BUTTON} pr-2`}
			>
				<HugeiconsIcon className="size-icon-xs" icon={Cancel01Icon} />
			</button>
			<div
				hidden={!open}
				onPointerDown={keepFromBarDrag}
				className="absolute inset-x-[-1px] bottom-full z-20 h-[min(28rem,calc(70vh/var(--app-zoom,1)))] overflow-hidden rounded-t-md border border-sidebar border-b-0 bg-bg text-[13px] text-fg leading-[1.7] shadow-lg"
			>
				<PanelTab id={tab.id} content={tab.content} />
			</div>
		</section>
	);
}

export function MinimizedTray({ indicator }: { indicator: ReactNode }) {
	const { minimized } = usePanels();
	const { shown: order, reorderShown } = useStatusBarOrder();
	const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
	const toggle = (id: string) =>
		setOpen((held) => {
			const next = new Set(held);
			if (!next.delete(id)) next.add(id);
			return next;
		});
	return (
		<StatusBar
			order={order}
			items={{
				panes: indicator,
				minimized: minimized.map((tab) => (
					<MinimizedWindow
						key={tab.id}
						tab={tab}
						open={open.has(tab.id)}
						onToggle={() => toggle(tab.id)}
					/>
				)),
			}}
			onReorder={reorderShown}
		/>
	);
}
