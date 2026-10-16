import { cn } from "../../lib/utils";

const DELAYS = ["0s", "0.5s", "1s"] as const;

function Dots({
	className,
	label = "Loading",
}: {
	className?: string;
	label?: string;
}) {
	return (
		<span
			role="status"
			aria-label={label}
			className={cn(
				"inline-flex size-icon items-center justify-between",
				className,
			)}
		>
			{DELAYS.map((delay) => (
				<span
					key={delay}
					style={{ animationDelay: delay }}
					className="aspect-square w-1/4 animate-dot rounded-full bg-current"
				/>
			))}
		</span>
	);
}

export { Dots };
