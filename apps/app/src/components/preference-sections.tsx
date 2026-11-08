import { HugeiconsIcon } from "@hugeicons/react";
import {
	SortableSide,
	SortableSides,
	SortableTree,
	ThemeSwatches,
} from "@repo/components";
import type { StatusBarItem } from "@repo/shared/status-bar";
import { fonts } from "@repo/ui";
import { motions } from "@repo/ui/motions.ts";
import { useEffect, useState } from "react";
import { useAppearance } from "../lib/appearance.tsx";
import { inDesktopShell, useDesktopSettings } from "../lib/desktop-shell.ts";
import { INPUT_HELPERS, type InputHelper } from "../lib/input-helpers.ts";
import { META_FIELDS, type MetaField } from "../lib/meta-fields.ts";
import {
	usePanelMotion,
	useTraceBesideChat,
	useTraceLink,
} from "../lib/preferences.ts";
import { useSidebarMotion, useSidebarSides } from "../lib/sidebar.ts";
import type { SidebarEntry } from "../lib/sidebar-order.ts";
import { useStatusBarOrder } from "../lib/status-bar.ts";
import { isGap } from "../lib/status-bar-order.ts";
import { useUI } from "../lib/ui.tsx";
import { EntryDragged } from "./entry-rail.tsx";
import { ENTRY_ICONS } from "./workspace-tree.tsx";

function MetaToggle({ field }: { field: { id: MetaField; label: string } }) {
	const { metaShown, toggleMeta } = useUI();
	const on = metaShown[field.id];
	return (
		<button
			type="button"
			aria-pressed={on}
			onClick={() => toggleMeta(field.id)}
			className="flex w-full cursor-pointer items-baseline gap-2 text-left"
		>
			<span className={`flex-1 ${on ? "text-fg" : "text-dim line-through"}`}>
				{field.label}
			</span>
			<span className="flex-none text-dim">{on ? "on" : "off"}</span>
		</button>
	);
}

function InputToggle({
	helper,
}: {
	helper: { id: InputHelper; label: string; hint: string };
}) {
	const { inputOn, toggleInput } = useUI();
	const on = inputOn[helper.id];
	return (
		<button
			type="button"
			aria-pressed={on}
			title={helper.hint}
			onClick={() => toggleInput(helper.id)}
			className="flex w-full cursor-pointer items-baseline gap-2 text-left"
		>
			<span className={`flex-1 ${on ? "text-fg" : "text-dim line-through"}`}>
				{helper.label}
			</span>
			<span className="flex-none text-dim">{on ? "on" : "off"}</span>
		</button>
	);
}

const BAR_LABELS: Record<StatusBarItem, string> = {
	panes: "pane indicator",
	desktop: "desktop status",
	clock: "clock",
};

function EmptySlot() {
	return <div className="py-0.5 text-dim">empty slot</div>;
}

function StatusBarList() {
	const { order, shown, reorder, toggle } = useStatusBarOrder();
	const { motion } = useSidebarMotion();
	return (
		<div className="px-4 text-[11.5px]">
			<SortableTree order={order} onReorder={reorder} motion={motion}>
				{(item) =>
					isGap(item) ? (
						<EmptySlot />
					) : (
						<div className="py-0.5">
							<button
								type="button"
								aria-pressed={shown.includes(item)}
								onClick={() => toggle(item)}
								className="flex w-full cursor-pointer items-baseline gap-2 text-left"
							>
								<span
									className={`flex-1 ${shown.includes(item) ? "text-fg" : "text-dim line-through"}`}
								>
									{BAR_LABELS[item]}
								</span>
								<span className="flex-none text-dim">
									{shown.includes(item) ? "on" : "off"}
								</span>
							</button>
						</div>
					)
				}
			</SortableTree>
		</div>
	);
}

function SidebarRow({ entry, on }: { entry: SidebarEntry; on: boolean }) {
	return (
		<span className="flex w-full items-center gap-2">
			<HugeiconsIcon
				icon={ENTRY_ICONS[entry]}
				className={`size-icon flex-none ${on ? "text-fg" : "text-dim"}`}
			/>
			<span
				className={`min-w-0 flex-1 truncate ${on ? "text-fg" : "text-dim line-through"}`}
			>
				{entry}
			</span>
			<span className="flex-none text-dim">{on ? "on" : "off"}</span>
		</span>
	);
}

function SidebarList() {
	const { sides, hidden, move, toggle } = useSidebarSides();
	const { motion } = useSidebarMotion();
	const on = (entry: SidebarEntry) => !hidden.includes(entry);
	return (
		<SortableSides
			sides={sides}
			onMove={move}
			motion={motion}
			overlay={(entry) => <EntryDragged entry={entry} />}
		>
			<div className="grid grid-cols-2 gap-4 px-4 text-[11.5px]">
				{(["left", "right"] as const).map((side) => (
					<div key={side} className="flex min-w-0 flex-col gap-1">
						<span className="text-dim">{side}</span>
						<SortableSide<SidebarEntry> side={side} className="min-h-24">
							{(entry) => (
								<div className="py-0.5">
									<button
										type="button"
										aria-pressed={on(entry)}
										onClick={() => toggle(entry)}
										className="w-full cursor-pointer text-left"
									>
										<SidebarRow entry={entry} on={on(entry)} />
									</button>
								</div>
							)}
						</SortableSide>
					</div>
				))}
			</div>
		</SortableSides>
	);
}

function ThemeList({ open }: { open: boolean }) {
	const { theme, shortlist, chooseTheme, openThemePicker } = useAppearance();
	const [shown, setShown] = useState(shortlist);
	useEffect(() => {
		if (!open) setShown(shortlist);
	}, [open, shortlist]);

	return (
		<div className="flex flex-col gap-1.5 px-4 text-[11.5px]">
			{shown.map((candidate) => {
				const chosen = candidate.id === theme.id;
				return (
					<button
						key={candidate.id}
						type="button"
						aria-pressed={chosen}
						onClick={() => chooseTheme(candidate.id)}
						className="flex w-full cursor-pointer items-center gap-2 text-left"
					>
						<ThemeSwatches theme={candidate} />
						<span className={`flex-1 ${chosen ? "text-fg" : "text-dim"}`}>
							{candidate.name}
						</span>
						{chosen && <span className="flex-none text-dim">on</span>}
					</button>
				);
			})}
			<button
				type="button"
				onClick={openThemePicker}
				className="cursor-pointer text-left text-dim hover:text-fg"
			>
				all themes…
			</button>
		</div>
	);
}

function FontList() {
	const { font, chooseFont } = useAppearance();
	return (
		<div className="flex flex-col gap-1.5 px-4 text-[11.5px]">
			{fonts.map((candidate) => {
				const chosen = candidate.id === font.id;
				return (
					<button
						key={candidate.id}
						type="button"
						aria-pressed={chosen}
						onClick={() => chooseFont(candidate.id)}
						className="flex w-full cursor-pointer items-baseline gap-2 text-left"
					>
						<span
							data-font={candidate.id}
							className={`flex-1 ${chosen ? "text-fg" : "text-dim"}`}
						>
							{candidate.name}
						</span>
						{chosen && <span className="flex-none text-dim">on</span>}
					</button>
				);
			})}
		</div>
	);
}

function PanelMotionToggle() {
	const { panelMotion, setPanelMotion } = usePanelMotion();
	return (
		<div className="flex flex-col gap-1.5 px-4 text-[11.5px]">
			{[true, false].map((on) => {
				const chosen = on === panelMotion;
				return (
					<button
						key={String(on)}
						type="button"
						aria-pressed={chosen}
						onClick={() => setPanelMotion(on)}
						className="flex w-full cursor-pointer items-baseline gap-2 text-left"
					>
						<span className={`flex-1 ${chosen ? "text-fg" : "text-dim"}`}>
							{on ? "animate" : "still"}
						</span>
						{chosen && <span className="flex-none text-dim">on</span>}
					</button>
				);
			})}
		</div>
	);
}

function OnOffToggle({
	label,
	on,
	set,
}: {
	label: string;
	on: boolean;
	set: (on: boolean) => void;
}) {
	return (
		<button
			type="button"
			aria-pressed={on}
			onClick={() => set(!on)}
			className="flex w-full cursor-pointer items-baseline gap-2 text-left"
		>
			<span className={`flex-1 ${on ? "text-fg" : "text-dim line-through"}`}>
				{label}
			</span>
			<span className="flex-none text-dim">{on ? "on" : "off"}</span>
		</button>
	);
}

function DeveloperToggles() {
	const { traceBesideChat, setTraceBesideChat } = useTraceBesideChat();
	const { traceLink, setTraceLink } = useTraceLink();
	return (
		<div className="flex flex-col gap-1.5 px-4 text-[11.5px]">
			<OnOffToggle
				label="trace beside chat"
				on={traceBesideChat}
				set={setTraceBesideChat}
			/>
			<OnOffToggle label="show in trace" on={traceLink} set={setTraceLink} />
		</div>
	);
}

function DesktopToggles() {
	const { settings, update } = useDesktopSettings();
	if (settings === undefined) return null;
	return (
		<div className="flex flex-col gap-1.5 px-4 text-[11.5px]">
			<OnOffToggle
				label="keep running when closed"
				on={settings.closeToTray}
				set={(closeToTray) => update({ closeToTray })}
			/>
			<OnOffToggle
				label="start at login"
				on={settings.openAtLogin}
				set={(openAtLogin) => update({ openAtLogin })}
			/>
		</div>
	);
}

function MotionList() {
	const { motion, chooseMotion } = useSidebarMotion();
	return (
		<div className="flex flex-col gap-1.5 px-4 text-[11.5px]">
			{motions.map((candidate) => {
				const chosen = candidate.id === motion;
				return (
					<button
						key={candidate.id}
						type="button"
						aria-pressed={chosen}
						title={candidate.name}
						onClick={() => chooseMotion(candidate.id)}
						className="flex w-full cursor-pointer items-baseline gap-2 text-left"
					>
						<span className={`flex-1 ${chosen ? "text-fg" : "text-dim"}`}>
							{candidate.id}
						</span>
						{chosen && <span className="flex-none text-dim">on</span>}
					</button>
				);
			})}
		</div>
	);
}

export function PreferenceSections() {
	return (
		<>
			<div className="px-4 text-[11px] text-dim uppercase tracking-[0.14em]">
				metadata
			</div>
			<div className="flex flex-col gap-1.5 px-4 text-[11.5px]">
				{META_FIELDS.map((field) => (
					<MetaToggle key={field.id} field={field} />
				))}
			</div>
			<div className="px-4 text-[11px] text-dim uppercase tracking-[0.14em]">
				input
			</div>
			<div className="flex flex-col gap-1.5 px-4 text-[11.5px]">
				{INPUT_HELPERS.map((helper) => (
					<InputToggle key={helper.id} helper={helper} />
				))}
			</div>
			<div className="px-4 text-[11px] text-dim uppercase tracking-[0.14em]">
				sidebar
			</div>
			<SidebarList />
			<div className="px-4 text-[11px] text-dim uppercase tracking-[0.14em]">
				bottom bar
			</div>
			<StatusBarList />
			<div className="px-4 text-[11px] text-dim uppercase tracking-[0.14em]">
				recent themes
			</div>
			<ThemeList open />
			<div className="px-4 text-[11px] text-dim uppercase tracking-[0.14em]">
				font
			</div>
			<FontList />
			<div className="px-4 text-[11px] text-dim uppercase tracking-[0.14em]">
				drag motion
			</div>
			<MotionList />
			<div className="px-4 text-[11px] text-dim uppercase tracking-[0.14em]">
				panel motion
			</div>
			<PanelMotionToggle />
			<div className="px-4 text-[11px] text-dim uppercase tracking-[0.14em]">
				developer
			</div>
			<DeveloperToggles />
			{inDesktopShell() && (
				<>
					<div className="px-4 text-[11px] text-dim uppercase tracking-[0.14em]">
						desktop
					</div>
					<DesktopToggles />
				</>
			)}
		</>
	);
}
