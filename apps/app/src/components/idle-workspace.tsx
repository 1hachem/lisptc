import { Add01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@repo/ui";
import { anchorOf } from "@repo/ui-catalog";
import { useId } from "react";
import { useNewChat } from "../lib/chats.ts";

export function IdleWorkspace() {
	const pencil = `pencil-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
	const newChat = useNewChat();
	return (
		<div className="flex items-center gap-6 text-dim">
			<svg
				viewBox="320 60 300 618"
				className="h-28 w-auto flex-none text-fg"
				fill="none"
				stroke="currentColor"
				strokeWidth="7"
				strokeLinecap="round"
				strokeLinejoin="round"
				role="img"
				aria-label="a tall figure poking the empty workspace with a stick"
			>
				<filter id={pencil}>
					<feTurbulence
						type="fractalNoise"
						baseFrequency="0.05"
						numOctaves="2"
						seed="7"
					/>
					<feDisplacementMap in="SourceGraphic" scale="4" />
				</filter>
				<g filter={`url(#${pencil})`}>
					<path d="M336 662 C337 600 337 520 338 455 C340 380 344 300 350 240 C356 190 366 150 382 118 C395 90 420 74 448 72 C468 71 478 85 474 108 C470 130 455 150 442 170 C428 192 418 220 413 255 C411 290 413 350 416 400 C420 440 428 520 432 660" />
					<path d="M355 662 C356 600 357 520 360 478 C362 458 400 456 404 476 C407 520 409 600 410 660" />
					<path d="M336 662 C340 668 351 668 355 662 M410 660 C414 666 428 666 432 660" />
					<path d="M368 262 C369 320 370 390 370 446 C362 452 348 454 339 452" />
					<path d="M372 418 C386 416 400 417 415 415 M372 431 C386 429 400 430 416 428" />
					<path d="M380 124 C405 119 440 123 470 130 M384 140 C400 160 420 178 442 184" />
					<circle cx="381" cy="125" r="5" fill="currentColor" />
					<path
						d="M404 141 C410 137 416 135 422 133 M431 137 C436 139 440 142 443 147"
						strokeWidth="4"
					/>
					<ellipse cx="414" cy="150" rx="7.5" ry="6.5" strokeWidth="4" />
					<circle cx="415" cy="153" r="3" fill="currentColor" stroke="none" />
					<ellipse cx="434" cy="156" rx="5" ry="4.5" strokeWidth="4" />
					<circle
						cx="434.5"
						cy="158"
						r="2.2"
						fill="currentColor"
						stroke="none"
					/>
					<path
						d="M388 226 C392 219 399 217 404 220 C406 222 407 224 408 227"
						strokeWidth="4"
					/>
					<path d="M413 285 C425 320 440 360 462 402 M419 332 C428 360 439 390 452 410" />
					<path d="M462 402 C471 410 466 421 456 419 C450 418 449 413 452 410" />
					<path d="M458 416 C470 432 485 452 498 470 C505 482 510 492 513 500 L508 520 M513 500 C526 506 540 515 548 528 C558 545 570 565 580 580 C587 592 592 600 595 606 M595 606 L590 596 M595 606 L600 595" />
				</g>
			</svg>
			<div className="flex flex-col gap-1">
				<div className="text-fg">c'mon,</div>
				<div className="text-fg">do something..</div>
				<div className="mt-3">drag anything in here</div>
				<Button
					{...anchorOf("panel/new-chat")}
					variant="outline"
					size="sm"
					className="mt-3 self-start"
					onClick={newChat}
				>
					<HugeiconsIcon icon={Add01Icon} />
					new chat
				</Button>
			</div>
		</div>
	);
}
