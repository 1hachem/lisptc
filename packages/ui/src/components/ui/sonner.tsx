import {
	Alert02Icon,
	CancelCircleIcon,
	CheckmarkCircle02Icon,
	InformationCircleIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type * as React from "react";
import { Toaster as Sonner, type ToasterProps, toast } from "sonner";

import type { ThemeScheme } from "../../themes.ts";
import { Spinner } from "./spinner.tsx";

const toastPositions = [
	"top-left",
	"top-center",
	"top-right",
	"bottom-left",
	"bottom-center",
	"bottom-right",
] as const satisfies NonNullable<ToasterProps["position"]>[];

type ToastPosition = (typeof toastPositions)[number];

const defaultToastPosition: ToastPosition = "bottom-right";

function Toaster({
	scheme,
	...props
}: Omit<ToasterProps, "theme"> & { scheme: ThemeScheme }) {
	return (
		<Sonner
			theme={scheme}
			className="toaster group"
			icons={{
				success: (
					<HugeiconsIcon
						icon={CheckmarkCircle02Icon}
						className="size-icon text-green"
					/>
				),
				info: (
					<HugeiconsIcon
						icon={InformationCircleIcon}
						className="size-icon text-blue"
					/>
				),
				warning: (
					<HugeiconsIcon icon={Alert02Icon} className="size-icon text-yellow" />
				),
				error: (
					<HugeiconsIcon
						icon={CancelCircleIcon}
						className="size-icon text-red"
					/>
				),
				loading: <Spinner />,
			}}
			style={
				{
					"--normal-bg": "var(--popover)",
					"--normal-text": "var(--popover-foreground)",
					"--normal-border": "var(--border)",
					"--border-radius": "var(--radius)",
				} as React.CSSProperties
			}
			toastOptions={{
				classNames: {
					toast: "font-mono text-sm",
					description: "text-muted-foreground",
				},
			}}
			{...props}
		/>
	);
}

export {
	defaultToastPosition,
	Toaster,
	type ToastPosition,
	toast,
	toastPositions,
};
