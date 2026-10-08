import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
	type ThemeDef,
	themes,
} from "@repo/ui";
import { useState } from "react";
import { readThemePref, writeThemePref } from "../lib/prefs.ts";

function Swatches({ theme }: { theme: ThemeDef }) {
	return (
		<span className="flex flex-none gap-px">
			{theme.swatches.map((swatch) => (
				<span
					key={swatch}
					className="size-2"
					style={{ backgroundColor: swatch }}
				/>
			))}
		</span>
	);
}

export function ThemeMenu() {
	const [current, setCurrent] = useState(readThemePref);

	return (
		<DropdownMenu>
			<DropdownMenuTrigger className="flex-none cursor-pointer text-dim hover:text-fg">
				theme
			</DropdownMenuTrigger>
			<DropdownMenuContent
				align="end"
				side="top"
				sideOffset={2}
				className="rounded-none border-bg2 bg-bg1 p-0 text-[11.5px] shadow-none"
			>
				{themes.map((theme) => (
					<DropdownMenuItem
						key={theme.id}
						onSelect={() => {
							writeThemePref(theme.id);
							setCurrent(theme.id);
						}}
						className={`flex items-center gap-2 rounded-none px-2.5 py-1 text-[11.5px] focus:bg-bg2 focus:text-fg ${theme.id === current ? "text-fg" : "text-dim"}`}
					>
						<Swatches theme={theme} />
						<span>{theme.name}</span>
					</DropdownMenuItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
