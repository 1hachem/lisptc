import { Sidebar, useSidebar } from "@repo/ui";
import { CHANNELS, type Channel } from "../lib/channels.ts";
import { useUI } from "../lib/ui.tsx";

function ChannelToggle({ channel }: { channel: Channel }) {
	const { shown, toggleChannel } = useUI();
	const on = shown[channel.id];
	return (
		<button
			type="button"
			onClick={() => toggleChannel(channel.id)}
			title={channel.hint}
			className="flex w-full items-baseline gap-2 text-left"
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

export function RightSidebar() {
	const { state, toggleSidebar } = useSidebar();
	const collapsed = state === "collapsed";

	return (
		<Sidebar side="right" collapsible="icon" className="border-l-0!">
			{collapsed ? (
				<div className="flex h-full flex-col items-center py-3.5">
					<button
						type="button"
						onClick={toggleSidebar}
						title="expand panel"
						className="text-dim hover:text-fg"
					>
						«
					</button>
				</div>
			) : (
				<div className="flex h-full flex-col gap-5 py-3.5">
					<div className="flex items-baseline gap-2 px-4">
						<span className="flex-1 text-[11px] text-dim uppercase tracking-[0.14em]">
							channels
						</span>
						<button
							type="button"
							onClick={toggleSidebar}
							title="collapse panel"
							className="flex-none text-dim hover:text-fg"
						>
							»
						</button>
					</div>
					<div className="flex flex-col gap-1.5 px-4 text-[11.5px]">
						{CHANNELS.map((channel) => (
							<ChannelToggle key={channel.id} channel={channel} />
						))}
					</div>
				</div>
			)}
		</Sidebar>
	);
}
