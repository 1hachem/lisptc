import { z } from "zod";

const MAX_LINE = 120;
const MAX_PARAGRAPH = 1_200;
const MAX_ITEMS = 12;
const MAX_SECTIONS = 20;

const line = z.string().trim().min(1).max(MAX_LINE);
const paragraph = z.string().trim().min(1).max(MAX_PARAGRAPH);
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "a colour is #rrggbb");
const flowId = z
	.string()
	.regex(
		/^[a-z0-9][a-z0-9-]{0,39}$/,
		"a flow id is lowercase words joined by -",
	);
const items = <T extends z.ZodType>(item: T) =>
	z.array(item).min(1).max(MAX_ITEMS);

const cta = z.strictObject({
	label: line,
	flow: flowId.optional(),
});

const link = z.strictObject({
	label: line,
	href: z.url({ protocol: /^https$/ }),
});

const theme = z.strictObject({
	base: line.optional(),
	accent: hex.optional(),
	font: line.optional(),
});

const hero = z.strictObject({
	type: z.literal("hero"),
	layout: z.enum(["centered", "split"]).optional(),
	eyebrow: line.optional(),
	title: line,
	subtitle: paragraph.optional(),
	cta: cta.optional(),
	secondary: link.optional(),
});

const features = z.strictObject({
	type: z.literal("features"),
	layout: z.enum(["grid", "list"]).optional(),
	title: line.optional(),
	items: items(
		z.strictObject({
			icon: line.optional(),
			title: line,
			body: paragraph,
		}),
	),
});

const steps = z.strictObject({
	type: z.literal("steps"),
	title: line.optional(),
	items: items(z.strictObject({ title: line, body: paragraph })),
});

const pricing = z.strictObject({
	type: z.literal("pricing"),
	title: line.optional(),
	plans: items(
		z.strictObject({
			name: line,
			price: line,
			period: line.optional(),
			features: items(line),
			cta: cta.optional(),
		}),
	),
});

const testimonials = z.strictObject({
	type: z.literal("testimonials"),
	title: line.optional(),
	items: items(
		z.strictObject({
			quote: paragraph,
			author: line,
			role: line.optional(),
		}),
	),
});

const faq = z.strictObject({
	type: z.literal("faq"),
	title: line.optional(),
	items: items(z.strictObject({ question: line, answer: paragraph })),
});

const callToAction = z.strictObject({
	type: z.literal("cta"),
	title: line,
	body: paragraph.optional(),
	cta,
});

const verticalDirectory = z.strictObject({
	type: z.literal("vertical-directory"),
	title: line.optional(),
});

export const section = z.discriminatedUnion("type", [
	hero,
	features,
	steps,
	pricing,
	testimonials,
	faq,
	callToAction,
	verticalDirectory,
]);

export const landingPage = z.strictObject({
	title: line,
	description: paragraph.optional(),
	theme: theme.optional(),
	sections: z.array(section).min(1).max(MAX_SECTIONS),
});

export type LandingPage = z.infer<typeof landingPage>;
export type Section = z.infer<typeof section>;
export type SectionType = Section["type"];
export type Cta = z.infer<typeof cta>;
export type Theme = z.infer<typeof theme>;

export const LANDING_PAGE_PATH = "landing-page.ptc";

export const sectionTypes: readonly SectionType[] = section.options.map(
	(option) => option.shape.type.value,
);

export type LandingResult =
	| { ok: true; page: LandingPage }
	| { ok: false; problems: string[] };

export function parseLandingPage(json: unknown): LandingResult {
	const parsed = landingPage.safeParse(json);
	if (parsed.success) return { ok: true, page: parsed.data };
	return {
		ok: false,
		problems: parsed.error.issues.map(
			(issue) =>
				`${issue.path.length === 0 ? "page" : issue.path.join(" ")}: ${issue.message}`,
		),
	};
}
