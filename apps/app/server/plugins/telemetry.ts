import { shutdownTelemetry } from "@repo/ai";
import { definePlugin } from "nitro";

export default definePlugin((nitroApp) => {
	nitroApp.hooks.hook("close", () => shutdownTelemetry());
});
