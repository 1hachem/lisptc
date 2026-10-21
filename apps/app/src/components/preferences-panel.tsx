import {
	BubbleChatIcon,
	KeyboardIcon,
	LayoutTwoColumnIcon,
	Move01Icon,
	PaintBoardIcon,
	SidebarLeftIcon,
	Tag01Icon,
	TextFontIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { ThemeSwatches } from "@repo/components";
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
import {
	INPUT_GROUPS,
	INPUT_HELPERS,
	type InputGroup,
	type InputHelper,
} from "../lib/input-helpers.ts";
import { META_FIELDS, type MetaField } from "../lib/meta-fields.ts";
import { usePanelMotion } from "../lib/preferences.ts";
import { useSidebarMotion, useSidebarOrder } from "../lib/sidebar.ts";
import type { SidebarEntry } from "../lib/sidebar-order.ts";
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

const SEND_LABEL_MAX = 16;

function SendLabel() {
	const { sendLabel, setSendLabel, inputOn } = useUI();
	const [draft, setDraft] = useState(sendLabel ?? "");
	useEffect(() => setDraft(sendLabel ?? ""), [sendLabel]);
	const commit = () => {
		const label = draft.trim();
		if (label === "" || label === sendLabel) setDraft(sendLabel ?? "");
		else setSendLabel(label);
	};
	return (
		<label
			className={`flex w-full items-baseline gap-2 ${inputOn.send ? "" : "opacity-50"}`}
		>
			<span className="flex-none text-dim">label</span>
			<input
				value={draft}
				maxLength={SEND_LABEL_MAX}
				disabled={!inputOn.send}
				aria-label="send button label"
				onChange={(event) => setDraft(event.target.value)}
				onBlur={commit}
				onKeyDown={(event) => {
					if (event.key === "Enter") event.currentTarget.blur();
					if (event.key === "Escape") {
						setDraft(sendLabel ?? "");
						event.currentTarget.blur();
					}
				}}
				className="min-w-0 flex-1 border-b border-bg2 bg-transparent text-right text-fg outline-none focus:border-yellow"
			/>
		</label>
	);
}

function InputSection({ group }: { group: InputGroup }) {
	return (
		<>
			<div className="px-4 text-[11px] text-dim uppercase tracking-[0.14em]">
				input {group}
			</div>
			<div className="flex flex-col gap-1.5 px-4 text-[11.5px]">
				{INPUT_HELPERS.filter((helper) => helper.group === group).map(
					(helper) => (
						<InputToggle key={helper.id} helper={helper} />
					),
				)}
				{group === "shows" && <SendLabel />}
			</div>
		</>
	);
}

function SidebarToggle({
	name,
	on,
	onToggle,
}: {
	name: SidebarEntry;
	on: boolean;
	onToggle: (name: SidebarEntry) => void;
}) {
	return (
		<button
			type="button"
			aria-pressed={on}
			onClick={() => onToggle(name)}
			className="flex w-full cursor-pointer items-baseline gap-2 text-left"
		>
			<span className={`flex-1 ${on ? "text-fg" : "text-dim line-through"}`}>
				{name}
			</span>
			<span className="flex-none text-dim">{on ? "on" : "off"}</span>
		</button>
	);
}

function SidebarList() {
	const { order, shown, toggleHidden } = useSidebarOrder();
	return (
		<div className="flex flex-col gap-1.5 px-4 text-[11.5px]">
			{order.map((name) => (
				<SidebarToggle
					key={name}
					name={name}
					on={shown.includes(name)}
					onToggle={toggleHidden}
				/>
			))}
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
	{ name: "sidebar", icon: SidebarLeftIcon },
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
			{INPUT_GROUPS.map((group) => (
				<InputSection key={group} group={group} />
			))}
			<div className="px-4 text-[11px] text-dim uppercase tracking-[0.14em]">
				sidebar
			</div>
			<SidebarList />
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
