import { Link } from "@tanstack/react-router";

export function Landing() {
	return (
		<div className="flex h-full items-center justify-center bg-bg font-mono text-[13px] text-fg">
			<div className="flex w-[320px] flex-col gap-3.5">
				<div>malleable AI agents workspaces</div>
				<div className="flex gap-2">
					<Link
						to="/login"
						className="flex-1 bg-bg2 px-2.5 py-1 text-center text-blue hover:brightness-125"
					>
						sign in
					</Link>
					<Link
						to="/download/thanks"
						className="flex-1 bg-bg2 px-2.5 py-1 text-center text-dim hover:text-fg"
					>
						download
					</Link>
				</div>
			</div>
		</div>
	);
}
