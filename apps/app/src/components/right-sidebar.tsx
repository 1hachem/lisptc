import { Sidebar, useSidebar } from "@repo/ui";
import { useState } from "react";
import { captureGraphOpened } from "../lib/analytics.tsx";
import { CHANNELS, type Channel } from "../lib/channels.ts";
import { useUI } from "../lib/ui.tsx";
import { GraphPanel } from "./graph-panel.tsx";

type Mode = "channels" | "graph";

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

function ModeTab({
	label,
	active,
	onClick,
}: {
	label: string;
	active: boolean;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={`text-[11px] uppercase tracking-[0.14em] ${active ? "text-fg" : "text-dim hover:text-fg"}`}
		>
			{label}
		</button>
	);
}

export function RightSidebar() {
	const { state, toggleSidebar } = useSidebar();
	const collapsed = state === "collapsed";
	const [mode, setMode] = useState<Mode>("channels");

	const showGraph = () => {
		if (mode !== "graph") captureGraphOpened({});
		setMode("graph");
	};

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
				<div className="flex h-full min-h-0 flex-col gap-5 py-3.5">
					<div className="flex items-baseline gap-3 px-4">
						<ModeTab
							label="channels"
							active={mode === "channels"}
							onClick={() => setMode("channels")}
						/>
						<ModeTab
							label="graph"
							active={mode === "graph"}
							onClick={showGraph}
						/>
						<span className="flex-1" />
						<button
							type="button"
							onClick={toggleSidebar}
							title="collapse panel"
							className="flex-none text-dim hover:text-fg"
						>
							»
						</button>
					</div>
					{mode === "channels" ? (
						<div className="flex flex-col gap-1.5 px-4 text-[11.5px]">
							{CHANNELS.map((channel) => (
								<ChannelToggle key={channel.id} channel={channel} />
							))}
						</div>
					) : (
						<GraphPanel />
					)}
				</div>
			)}
		</Sidebar>
	);
}
