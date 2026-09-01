import app from "./app.ts";
import { startServer } from "./server.ts";

startServer({
	fetch: app.fetch,
	port: Number(process.env.PORT ?? 3001),
});
