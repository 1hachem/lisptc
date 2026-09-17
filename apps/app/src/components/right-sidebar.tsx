import { CHANNELS, type Channel } from "../lib/channels.ts";
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

export function RightSidebar({ open }: { open: boolean }) {
	return (
		<SidePanel side="right" open={open} className="w-[214px]">
			<div className="flex h-full flex-col gap-5 py-3.5">
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
			</div>
		</SidePanel>
	);
}
