import type { ReactNode } from "react";
import { useId } from "react";

export function EverythingFine({ children }: { children?: ReactNode }) {
	const rough = `rough-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
	return (
		<div className="flex min-h-full w-full items-center justify-center gap-6 p-8 text-dim">
			<svg
				viewBox="0 20 400 250"
				className="h-28 w-auto flex-none text-fg"
				fill="none"
				stroke="currentColor"
				strokeLinecap="round"
				strokeLinejoin="round"
				role="img"
				aria-label="a calm character sipping tea in a burning room"
			>
				<filter id={rough} x="-5%" y="-5%" width="110%" height="110%">
					<feTurbulence
						type="fractalNoise"
						baseFrequency="0.035"
						numOctaves="2"
						seed="7"
					/>
					<feDisplacementMap in="SourceGraphic" scale="4" />
				</filter>
				<g filter={`url(#${rough})`}>
					<path
						d="M95 231 C100 230 110 231 116 231 M152 231 C200 229 260 233 328 230"
						strokeWidth="5"
					/>
					<path
						d="M-10 38 C20 58 50 30 80 48 C110 64 140 36 172 52 C204 66 230 38 260 54 C290 68 320 40 350 56 C375 66 395 46 410 50"
						strokeWidth="3.5"
					/>
					<g transform="rotate(-6 85 120)">
						<rect x="55" y="92" width="62" height="48" strokeWidth="4" />
						<path
							d="M62 132 L78 114 L90 126 L100 116 L111 132"
							strokeWidth="3"
						/>
					</g>
					<path d="M150 196 C200 193 250 198 290 195" strokeWidth="6" />
					<path d="M165 197 L160 262 M276 196 L282 262" strokeWidth="5" />
					<rect
						x="184"
						y="120"
						width="74"
						height="72"
						rx="16"
						strokeWidth="5"
					/>
					<ellipse
						cx="213"
						cy="152"
						rx="5.5"
						ry="9"
						fill="currentColor"
						strokeWidth="2"
					/>
					<ellipse
						cx="229"
						cy="152"
						rx="5.5"
						ry="9"
						fill="currentColor"
						strokeWidth="2"
					/>
					<path d="M257 170 C263 172 267 176 270 181" strokeWidth="5" />
					<path d="M266 170 L268 192 L290 192 L292 170 Z" strokeWidth="4" />
					<path d="M292 175 C302 175 302 187 291 187" strokeWidth="4" />
					<path d="M274 162 C270 154 280 150 276 142" strokeWidth="2.5" />
					<path d="M285 162 C281 154 291 150 287 142" strokeWidth="2.5" />
					<path
						d="M0 232 C10 190 30 200 28 160 C50 185 55 150 60 120 C80 160 70 190 90 175 C95 200 100 215 95 232"
						strokeWidth="4"
					/>
					<path
						d="M22 232 C28 210 38 212 40 190 C54 203 58 186 63 172 C72 198 70 216 76 232"
						strokeWidth="2.5"
					/>
					<path
						d="M330 232 C325 200 345 195 340 160 C362 180 365 140 375 110 C392 150 385 175 400 168 L405 232"
						strokeWidth="4"
					/>
					<path
						d="M348 232 C348 212 358 207 357 188 C370 202 374 180 379 166 C390 192 386 212 396 232"
						strokeWidth="2.5"
					/>
					<path
						d="M118 232 C116 214 126 214 124 198 C136 210 138 198 142 188 C150 206 146 220 150 232"
						strokeWidth="4"
					/>
				</g>
			</svg>
			<div className="flex min-w-0 flex-col gap-1">
				<div className="text-fg">everything’s</div>
				<div className="text-fg">fine.</div>
				<div className="mt-3 flex flex-col items-start gap-1">{children}</div>
			</div>
		</div>
	);
}
