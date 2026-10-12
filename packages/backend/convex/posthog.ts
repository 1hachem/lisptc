import { PostHog } from "@posthog/convex";
import { components } from "./_generated/api.js";

export const posthog = new PostHog(components.posthog);
