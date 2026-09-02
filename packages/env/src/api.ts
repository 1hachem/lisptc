import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

// The API's own environment, from the `/api` Infisical path.
//
// `APP_URL` is the browser origin allowed to call this API. Required, with no
// wildcard to fall back to: this is the one setting that has to fail in the
// closed direction, so a deployment that forgets it refuses to boot rather than
// quietly accepting every origin on the internet.
//
// A full origin, scheme included — an `Origin` header is never a bare hostname,
// so `example.com` would silently match nothing at all.
export const apiEnv = createEnv({
	server: {
		APP_URL: z.url(),
	},
	runtimeEnv: process.env,
	emptyStringAsUndefined: true,
});
