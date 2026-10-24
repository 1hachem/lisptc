import {
	BubbleChatIcon,
	KeyboardIcon,
	LayoutTwoColumnIcon,
	Move01Icon,
	PaintBoardIcon,
	Tag01Icon,
	TextFontIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { SortableTree, ThemeSwatches } from "@repo/components";
import {
	fonts,
	Sidebar,
	SidebarContent,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarRail,
	useSidebar,
} from "@repo/ui";
import { motions } from "@repo/ui/motions.ts";
import { useEffect, useState } from "react";
import { useAppearance } from "../lib/appearance.tsx";
import { CHANNELS, type Channel } from "../lib/channels.ts";
import { INPUT_HELPERS, type InputHelper } from "../lib/input-helpers.ts";
import { META_FIELDS, type MetaField } from "../lib/meta-fields.ts";
import { usePanelMotion } from "../lib/preferences.ts";
import { useSidebarMotion } from "../lib/sidebar.ts";
import { useStatusBarOrder } from "../lib/status-bar.ts";
import { type BarItem, GAP } from "../lib/status-bar-order.ts";
import { useUI } from "../lib/ui.tsx";

function ChannelToggle({ channel }: { channel: Channel }) {
	const { shown, toggleChannel } = useUI();
	const on = shown[channel.id];
	return (
		<button
			type="button"
			onClick={() => toggleChannel(channel.id)}
			title={channel.hint}
			className="flex w-full cursor-pointer items-baseline gap-2 text-left"
		>
			<span
				aria-hidden
				className={`size-1.5 flex-none translate-y-[-1px] rounded-full ${channel.dot} ${on ? "" : "opacity-25"}`}
			/>
			<span className={`flex-1 ${on ? "text-fg" : "text-dim line-through"}`}>
				{channel.label}
			</span>
			<span className="flex-none text-dim">{on ? "on" : "off"}</span>
		</button>
	);
}

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

const BAR_LABELS: Record<BarItem, string> = {
	panes: "pane indicator",
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
					item === GAP ? (
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

const SECTIONS: { name: string; icon: IconSvgElement }[] = [
	{ name: "channels", icon: BubbleChatIcon },
	{ name: "metadata", icon: Tag01Icon },
	{ name: "input", icon: KeyboardIcon },
	{ name: "recent themes", icon: PaintBoardIcon },
	{ name: "font", icon: TextFontIcon },
	{ name: "drag motion", icon: Move01Icon },
	{ name: "panel motion", icon: LayoutTwoColumnIcon },
];

function SectionRail() {
	const { setOpen } = useSidebar();
	return (
		<SidebarMenu className="items-center gap-0.5 py-3.5">
			{SECTIONS.map((section) => (
				<SidebarMenuItem key={section.name}>
					<SidebarMenuButton
						tooltip={section.name}
						className="group-data-[collapsible=icon]:size-6! group-data-[collapsible=icon]:p-1!"
						onClick={() => setOpen(true)}
					>
						<HugeiconsIcon icon={section.icon} />
						<span>{section.name}</span>
					</SidebarMenuButton>
				</SidebarMenuItem>
			))}
		</SidebarMenu>
	);
}

export function PreferencesPanel() {
	const { state } = useSidebar();
	return (
		<Sidebar side="right" collapsible="icon" className="border-sidebar">
			<SidebarContent>
				{state === "expanded" ? <Preferences /> : <SectionRail />}
			</SidebarContent>
			<SidebarRail className="hover:after:bg-transparent" />
		</Sidebar>
	);
}

function Preferences() {
	return (
		<div className="flex h-full flex-col gap-5 overflow-y-auto py-3.5">
			<div className="px-4 text-[11px] text-dim uppercase tracking-[0.14em]">
				channels
			</div>
			<div className="flex flex-col gap-1.5 px-4 text-[11.5px]">
				{CHANNELS.map((channel) => (
					<ChannelToggle key={channel.id} channel={channel} />
				))}
			</div>
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
		</div>
	);
}
