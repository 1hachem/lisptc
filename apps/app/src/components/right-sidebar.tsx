import { ThemeSwatches } from "@repo/components";
import { fonts, toastPositions } from "@repo/ui";
import { useEffect, useState } from "react";
import { useAppearance } from "../lib/appearance.tsx";
import { CHANNELS, type Channel } from "../lib/channels.ts";
import { META_FIELDS, type MetaField } from "../lib/meta-fields.ts";
import { useUI } from "../lib/ui.tsx";
import { SidePanel } from "./side-panel.tsx";

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

function ToastPositionPicker() {
	const { toastPosition, chooseToastPosition } = useAppearance();
	return (
		<div className="px-4">
			<div className="grid aspect-video grid-cols-3 grid-rows-[auto_1fr_auto] border border-bg2 p-1">
				{toastPositions.map((position) => {
					const chosen = position === toastPosition;
					const label = position.replace("-", " ");
					return (
						<button
							key={position}
							type="button"
							aria-pressed={chosen}
							aria-label={label}
							title={label}
							onClick={() => chooseToastPosition(position)}
							className={`h-row cursor-pointer p-1 ${position.startsWith("bottom") ? "row-start-3" : ""}`}
						>
							<span
								className={`block h-full ${chosen ? "bg-fg" : "bg-bg2 hover:bg-dim"}`}
							/>
						</button>
					);
				})}
			</div>
		</div>
	);
}

export function RightSidebar({ open }: { open: boolean }) {
	return (
		<SidePanel side="right" open={open} className="w-[214px]">
			<div className="flex h-full flex-col gap-5 overflow-y-auto py-3.5">
				<div className="flex items-baseline gap-2 px-4">
					<span className="flex-1 text-[11px] text-dim uppercase tracking-[0.14em]">
						channels
					</span>
					<span aria-hidden className="invisible">
						»
					</span>
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
					recent themes
				</div>
				<ThemeList open={open} />
				<div className="px-4 text-[11px] text-dim uppercase tracking-[0.14em]">
					font
				</div>
				<FontList />
				<div className="px-4 text-[11px] text-dim uppercase tracking-[0.14em]">
					toasts
				</div>
				<ToastPositionPicker />
			</div>
		</SidePanel>
	);
}
