import { HugeiconsIcon } from "@hugeicons/react";
import type { Cta, Section } from "@repo/landing";
import { cn } from "@repo/ui/lib/utils";
import type { ReactNode } from "react";
import { arrowIcon, landingIcon } from "./icons.ts";

export type StartHref = (cta: Cta) => string;

export interface DirectoryEntry {
	name: string;
	description?: string;
	href: string;
}

export interface SectionContext {
	start: StartHref;
	verticals: readonly DirectoryEntry[];
}

type Of<T extends Section["type"]> = Extract<Section, { type: T }>;

function Band({
	title,
	children,
	className,
}: {
	title?: string;
	children: ReactNode;
	className?: string;
}) {
	return (
		<section className={cn("mx-auto w-full max-w-page px-4 py-12", className)}>
			{title === undefined ? null : (
				<h2 className="mb-6 text-headline text-fg">{title}</h2>
			)}
			{children}
		</section>
	);
}

function CtaLink({ cta, start }: { cta: Cta; start: StartHref }) {
	return (
		<a
			href={start(cta)}
			className="inline-flex h-control-lg items-center gap-2 bg-brand px-3 text-bg hover:opacity-90"
		>
			{cta.label}
			<HugeiconsIcon icon={arrowIcon} className="size-icon" />
		</a>
	);
}

function Hero({ section, start }: { section: Of<"hero"> } & SectionContext) {
	const split = section.layout === "split";
	return (
		<section
			className={cn(
				"mx-auto flex w-full max-w-page flex-col gap-4 px-4 py-16",
				split ? "items-start text-left" : "items-center text-center",
			)}
		>
			{section.eyebrow === undefined ? null : (
				<p className="text-sm text-brand">{section.eyebrow}</p>
			)}
			<h1 className="text-display text-fg">{section.title}</h1>
			{section.subtitle === undefined ? null : (
				<p className="max-w-dialog-lg text-lg text-dim">{section.subtitle}</p>
			)}
			<div className="flex flex-wrap items-center gap-3">
				{section.cta === undefined ? null : (
					<CtaLink cta={section.cta} start={start} />
				)}
				{section.secondary === undefined ? null : (
					<a
						href={section.secondary.href}
						rel="noreferrer"
						className="text-sm text-dim underline-offset-4 hover:underline"
					>
						{section.secondary.label}
					</a>
				)}
			</div>
		</section>
	);
}

function Features({ section }: { section: Of<"features"> }) {
	return (
		<Band title={section.title}>
			<ul
				className={cn(
					"grid gap-4",
					section.layout === "list" ? "grid-cols-1" : "sm:grid-cols-3",
				)}
			>
				{section.items.map((item) => {
					const icon = landingIcon(item.icon);
					return (
						<li key={item.title} className="flex flex-col gap-2 bg-bg1 p-4">
							{icon === undefined ? null : (
								<HugeiconsIcon icon={icon} className="size-icon text-brand" />
							)}
							<h3 className="text-lg text-fg">{item.title}</h3>
							<p className="text-sm text-dim">{item.body}</p>
						</li>
					);
				})}
			</ul>
		</Band>
	);
}

function Steps({ section }: { section: Of<"steps"> }) {
	return (
		<Band title={section.title}>
			<ol className="flex flex-col gap-4">
				{section.items.map((item, index) => (
					<li key={item.title} className="flex gap-4">
						<span className="text-lg text-brand">{index + 1}</span>
						<div className="flex flex-col gap-1">
							<h3 className="text-lg text-fg">{item.title}</h3>
							<p className="text-sm text-dim">{item.body}</p>
						</div>
					</li>
				))}
			</ol>
		</Band>
	);
}

function Pricing({
	section,
	start,
}: { section: Of<"pricing"> } & SectionContext) {
	return (
		<Band title={section.title}>
			<ul className="grid gap-4 sm:grid-cols-3">
				{section.plans.map((plan) => (
					<li key={plan.name} className="flex flex-col gap-3 bg-bg1 p-4">
						<h3 className="text-lg text-fg">{plan.name}</h3>
						<p className="text-headline text-fg">
							{plan.price}
							{plan.period === undefined ? null : (
								<span className="text-sm text-dim"> / {plan.period}</span>
							)}
						</p>
						<ul className="flex flex-col gap-1 text-sm text-dim">
							{plan.features.map((feature) => (
								<li key={feature}>{feature}</li>
							))}
						</ul>
						{plan.cta === undefined ? null : (
							<CtaLink cta={plan.cta} start={start} />
						)}
					</li>
				))}
			</ul>
		</Band>
	);
}

function Testimonials({ section }: { section: Of<"testimonials"> }) {
	return (
		<Band title={section.title}>
			<ul className="grid gap-4 sm:grid-cols-2">
				{section.items.map((item) => (
					<li key={item.author} className="flex flex-col gap-2 bg-bg1 p-4">
						<blockquote className="text-sm text-fg">{item.quote}</blockquote>
						<p className="text-xs text-dim">
							{item.author}
							{item.role === undefined ? null : `, ${item.role}`}
						</p>
					</li>
				))}
			</ul>
		</Band>
	);
}

function Faq({ section }: { section: Of<"faq"> }) {
	return (
		<Band title={section.title}>
			<dl className="flex flex-col gap-4">
				{section.items.map((item) => (
					<div key={item.question} className="flex flex-col gap-1">
						<dt className="text-lg text-fg">{item.question}</dt>
						<dd className="text-sm text-dim">{item.answer}</dd>
					</div>
				))}
			</dl>
		</Band>
	);
}

function CallToAction({
	section,
	start,
}: { section: Of<"cta"> } & SectionContext) {
	return (
		<Band className="flex flex-col items-center gap-4 text-center">
			<h2 className="text-headline text-fg">{section.title}</h2>
			{section.body === undefined ? null : (
				<p className="text-sm text-dim">{section.body}</p>
			)}
			<CtaLink cta={section.cta} start={start} />
		</Band>
	);
}

function VerticalDirectory({
	section,
	verticals,
}: { section: Of<"vertical-directory"> } & SectionContext) {
	if (verticals.length === 0) return null;
	return (
		<Band title={section.title}>
			<ul className="grid gap-4 sm:grid-cols-3">
				{verticals.map((vertical) => (
					<li key={vertical.href}>
						<a
							href={vertical.href}
							className="flex h-full flex-col gap-2 bg-bg1 p-4 hover:bg-bg2"
						>
							<h3 className="text-lg text-fg">{vertical.name}</h3>
							{vertical.description === undefined ? null : (
								<p className="text-sm text-dim">{vertical.description}</p>
							)}
						</a>
					</li>
				))}
			</ul>
		</Band>
	);
}

export function LandingSection({
	section,
	...context
}: { section: Section } & SectionContext) {
	switch (section.type) {
		case "hero":
			return <Hero section={section} {...context} />;
		case "features":
			return <Features section={section} />;
		case "steps":
			return <Steps section={section} />;
		case "pricing":
			return <Pricing section={section} {...context} />;
		case "testimonials":
			return <Testimonials section={section} />;
		case "faq":
			return <Faq section={section} />;
		case "cta":
			return <CallToAction section={section} {...context} />;
		case "vertical-directory":
			return <VerticalDirectory section={section} {...context} />;
	}
}
