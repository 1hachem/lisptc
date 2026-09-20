export function SidePanel({
	side,
	open,
	className,
	children,
}: {
	side: "left" | "right";
	open: boolean;
	className: string;
	children: React.ReactNode;
}) {
	const away = side === "left" ? "-translate-x-full" : "translate-x-full";
	return (
		<aside
			inert={!open}
			className={`absolute inset-y-0 z-20 bg-sidebar transition-transform duration-200 ease-linear ${
				side === "left" ? "left-0" : "right-0"
			} ${open ? "translate-x-0" : away} ${className}`}
		>
			{children}
		</aside>
	);
}
