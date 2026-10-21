import {
	ArrowDown01Icon,
	Cancel01Icon,
	Maximize01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { type ReactNode, useState } from "react";
import { tabLabel } from "../lib/panel-ops.ts";
import { usePanels } from "../lib/panels.tsx";
import { useStatusBarOrder } from "../lib/status-bar.ts";
import { PanelTab } from "./panel-tab.tsx";
import { StatusBar } from "./status-bar.tsx";

const BAR_BUTTON =
	"flex h-full flex-none cursor-pointer items-center px-1.5 text-dim hover:text-fg";

export function MinimizedTray({ indicator }: { indicator: ReactNode }) {
	const { minimized, restore, dismiss } = usePanels();
	const { shown: order } = useStatusBarOrder();
	const [open, setOpen] = useState<string | null>(null);
	const shown = minimized.some((t) => t.id === open) ? open : null;
	return (
		<div className="flex flex-col">
			{minimized.map((tab) => {
				const label = tabLabel(tab.content);
				return (
					<section
						key={tab.id}
						aria-label={label}
						hidden={shown !== tab.id}
						className="h-[calc(40vh/var(--app-zoom,1))] min-h-0 flex-col border-sidebar border-t bg-bg [&:not([hidden])]:flex"
					>
						<div className="flex h-control flex-none items-center gap-1 border-border border-b bg-bg1 pl-3">
							<span className="min-w-0 flex-1 truncate text-fg">{label}</span>
							<button
								type="button"
								aria-label={`collapse ${label} into the bar`}
								title="collapse"
								onClick={() => setOpen(null)}
								className={BAR_BUTTON}
							>
								<HugeiconsIcon
									className="size-icon-sm"
									icon={ArrowDown01Icon}
								/>
							</button>
							<button
								type="button"
								aria-label={`put ${label} back in the layout`}
								title="maximize"
								onClick={() => restore(tab.id)}
								className={BAR_BUTTON}
							>
								<HugeiconsIcon className="size-icon-sm" icon={Maximize01Icon} />
							</button>
							<button
								type="button"
								aria-label={`close ${label}`}
								title="close"
								onClick={() => dismiss(tab.id)}
								className={`${BAR_BUTTON} pr-2`}
							>
								<HugeiconsIcon className="size-icon-sm" icon={Cancel01Icon} />
							</button>
						</div>
						<div className="min-h-0 flex-1">
							<PanelTab id={tab.id} content={tab.content} />
						</div>
					</section>
				);
			})}
			<StatusBar
				order={order}
				items={{
					panes: indicator,
					minimized: minimized.map((tab) => {
						const label = tabLabel(tab.content);
						const active = shown === tab.id;
						return (
							<div key={tab.id} className="flex h-full items-center">
								<button
									type="button"
									aria-pressed={active}
									title={active ? `collapse ${label}` : `open ${label}`}
									onClick={() => setOpen(active ? null : tab.id)}
									className={`flex h-full max-w-40 cursor-pointer items-center px-2.5 ${active ? "bg-bg2 text-fg" : "hover:text-fg"}`}
								>
									<span className="truncate">{label}</span>
								</button>
								<button
									type="button"
									aria-label={`put ${label} back in the layout`}
									title="maximize"
									onClick={() => restore(tab.id)}
									className={BAR_BUTTON}
								>
									<HugeiconsIcon
										className="size-icon-xs"
										icon={Maximize01Icon}
									/>
								</button>
							</div>
						);
					}),
				}}
			/>
		</div>
	);
}
