import {
	createFileRoute,
	Navigate,
	redirect,
	useNavigate,
} from "@tanstack/react-router";
import { useConvexAuth } from "convex/react";
import { useState } from "react";
import { authClient } from "../lib/auth-client.ts";

export const Route = createFileRoute("/login")({
	beforeLoad: ({ context }) => {
		if (context.auth.source === "server" && context.auth.token !== null) {
			throw redirect({ to: "/" });
		}
	},
	component: Login,
});

type Mode = "sign-in" | "sign-up";

function Login() {
	const navigate = useNavigate();
	const { isAuthenticated, isLoading } = useConvexAuth();
	const [mode, setMode] = useState<Mode>("sign-in");
	const [name, setName] = useState("");
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	const land = () => navigate({ to: "/", replace: true });

	const run = async (
		attempt: () => Promise<{ error?: { message?: string } | null }>,
	) => {
		setBusy(true);
		setError(null);
		try {
			const { error: failure } = await attempt();
			if (failure) {
				setError(failure.message ?? "that did not work");
				return;
			}
			await land();
		} catch (ex) {
			setError(ex instanceof Error ? ex.message : String(ex));
		} finally {
			setBusy(false);
		}
	};

	if (isLoading) return null;
	if (isAuthenticated) return <Navigate to="/" replace />;

	return (
		<div className="flex h-full items-center justify-center bg-bg font-mono text-[13px] text-fg">
			<div className="flex w-[320px] flex-col gap-3.5">
				<div className="text-orange">ptc</div>

				<form
					className="flex flex-col gap-2"
					onSubmit={(event) => {
						event.preventDefault();
						void run(() =>
							mode === "sign-in"
								? authClient.signIn.email({ email, password })
								: authClient.signUp.email({ name, email, password }),
						);
					}}
				>
					{mode === "sign-up" ? (
						<input
							value={name}
							onChange={(event) => setName(event.target.value)}
							placeholder="name"
							autoComplete="name"
							className="bg-bg2 px-2.5 py-1 outline-none"
						/>
					) : null}
					<input
						value={email}
						onChange={(event) => setEmail(event.target.value)}
						placeholder="email"
						type="email"
						autoComplete="email"
						className="bg-bg2 px-2.5 py-1 outline-none"
					/>
					<input
						value={password}
						onChange={(event) => setPassword(event.target.value)}
						placeholder="password"
						type="password"
						autoComplete={
							mode === "sign-in" ? "current-password" : "new-password"
						}
						className="bg-bg2 px-2.5 py-1 outline-none"
					/>
					<button
						type="submit"
						disabled={busy}
						className="bg-bg2 px-2.5 py-1 text-blue hover:brightness-125 disabled:text-dim"
					>
						{mode === "sign-in" ? "sign in" : "sign up"}
					</button>
				</form>

				<div className="flex gap-2">
					<button
						type="button"
						disabled={busy}
						onClick={() =>
							void authClient.signIn.social({
								provider: "github",
								callbackURL: window.location.origin,
							})
						}
						className="flex-1 bg-bg2 px-2.5 py-1 text-dim hover:text-fg"
					>
						github
					</button>
					<button
						type="button"
						disabled={busy}
						onClick={() =>
							void authClient.signIn.social({
								provider: "google",
								callbackURL: window.location.origin,
							})
						}
						className="flex-1 bg-bg2 px-2.5 py-1 text-dim hover:text-fg"
					>
						google
					</button>
					<button
						type="button"
						disabled={busy}
						onClick={() => void run(() => authClient.signIn.passkey())}
						className="flex-1 bg-bg2 px-2.5 py-1 text-dim hover:text-fg"
					>
						passkey
					</button>
				</div>

				<button
					type="button"
					onClick={() => setMode(mode === "sign-in" ? "sign-up" : "sign-in")}
					className="text-left text-[11.5px] text-dim hover:text-fg"
				>
					{mode === "sign-in"
						? "no account yet? sign up"
						: "already have an account? sign in"}
				</button>

				{error ? <div className="text-[11.5px] text-red">{error}</div> : null}
			</div>
		</div>
	);
}
