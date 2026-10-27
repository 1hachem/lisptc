import { PauseIcon, PlayIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useRef, useState } from "react";

export function clock(seconds: number): string {
	if (!Number.isFinite(seconds)) return "-:--";
	const whole = Math.floor(seconds);
	return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

export function AudioPlayer({ name, url }: { name: string; url: string }) {
	const audio = useRef<HTMLAudioElement>(null);
	const [playing, setPlaying] = useState(false);
	const [at, setAt] = useState(0);
	const [length, setLength] = useState(Number.NaN);
	const toggle = () => {
		const element = audio.current;
		if (!element) return;
		if (element.paused) void element.play();
		else element.pause();
	};

	return (
		<div className="flex items-center gap-2.5 border border-bg2 bg-bg1 px-3 py-1.5 font-mono text-[11.5px]">
			{
				// biome-ignore lint/a11y/useMediaCaption: an uploaded file carries no captions to offer
				<audio
					ref={audio}
					src={url}
					preload="metadata"
					onPlay={() => setPlaying(true)}
					onPause={() => setPlaying(false)}
					onEnded={() => setPlaying(false)}
					onTimeUpdate={(event) => setAt(event.currentTarget.currentTime)}
					onLoadedMetadata={(event) => setLength(event.currentTarget.duration)}
				/>
			}
			<button
				type="button"
				onClick={toggle}
				className="flex h-auto flex-none cursor-pointer items-center gap-[7px] rounded-none bg-bg2 px-[9px] py-px text-green hover:brightness-125"
			>
				<span>{playing ? "pause" : "play"}</span>
				<HugeiconsIcon
					icon={playing ? PauseIcon : PlayIcon}
					className="size-icon-xs text-dim"
				/>
			</button>
			<input
				type="range"
				aria-label={`seek ${name}`}
				min={0}
				max={Number.isFinite(length) ? length : 0}
				step="any"
				value={at}
				onChange={(event) => {
					if (audio.current)
						audio.current.currentTime = Number(event.target.value);
				}}
				className="h-1 min-w-0 flex-1 cursor-pointer accent-yellow"
			/>
			<span className="flex-none text-dim tabular-nums">
				{clock(at)} / {clock(length)}
			</span>
		</div>
	);
}
