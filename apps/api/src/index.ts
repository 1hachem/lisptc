import { createApp } from "./app.ts";
import { startServer } from "./server.ts";

const app = createApp();

startServer({
	fetch: app.fetch,
	port: Number(process.env.PORT ?? 3001),
	exitOnUncaught: true,
});
