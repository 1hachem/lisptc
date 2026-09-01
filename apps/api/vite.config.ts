import devServer from "@hono/vite-dev-server";
import { defineConfig } from "vite";

// Dev only: vite owns the socket and re-evaluates the module graph on save, so
// an edit never rebinds the port (`node --watch` restarted the process, and a
// shutdown blocked on open SSE streams regularly left the replacement dying on
// EADDRINUSE). Production still runs the sources directly — `src/index.ts`.
export default defineConfig({
	server: {
		port: Number(process.env.PORT ?? 3001),
		// Fail loudly instead of silently moving to the next port, which the app's
		// hard-coded API base URL would never find.
		strictPort: true,
	},
	plugins: [devServer({ entry: "src/app.ts" })],
});
