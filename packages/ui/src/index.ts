// Terminal typewriter primitive

// Vercel AI Elements (scaffolded via `npx ai-elements`). The terminal UI
// renders typewriter text, so the markdown-oriented `message` element (which
// pulls the Streamdown → shiki stack) isn't included; add it back via the CLI
// if a consumer needs rich markdown/code rendering.
export * from "./components/ai-elements/conversation.tsx";
export * from "./components/ai-elements/prompt-input.tsx";
export * from "./components/ai-elements/suggestion.tsx";
export {
	Typewriter,
	type TypewriterProps,
	useTypewriter,
} from "./components/typewriter.tsx";
// shadcn primitives (scaffolded via the shadcn CLI)
export { Button, buttonVariants } from "./components/ui/button.tsx";
export { Input } from "./components/ui/input.tsx";
export { Switch } from "./components/ui/switch.tsx";

export { cn } from "./lib/utils.ts";
export { defaultThemeId, type ThemeDef, themes } from "./themes.ts";
