import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { cn } from "../../lib/utils";

const alertVariants = cva(
	"relative grid w-full grid-cols-[0_1fr] items-start gap-y-0.5 rounded-lg border px-3 py-2 text-sm has-[>svg]:grid-cols-[var(--spacing-icon)_1fr] has-[>svg]:gap-x-2 [&>svg]:size-icon [&>svg]:translate-y-0.5 [&>svg]:text-current",
	{
		variants: {
			variant: {
				default: "bg-card text-card-foreground",
				destructive:
					"bg-card text-destructive *:data-[slot=alert-description]:text-destructive/90 [&>svg]:text-current",
			},
		},
		defaultVariants: {
			variant: "default",
		},
	},
);

function Alert({
	className,
	variant,
	...props
}: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
	return (
		<div
			data-slot="alert"
			role="alert"
			className={cn(alertVariants({ variant }), className)}
			{...props}
		/>
	);
}

function AlertDescription({
	className,
	...props
}: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="alert-description"
			className={cn(
				"col-start-2 grid justify-items-start gap-1 text-muted-foreground text-sm [&_p]:leading-relaxed",
				className,
			)}
			{...props}
		/>
	);
}

export { Alert, AlertDescription };
