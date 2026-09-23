import type { NextConfig } from "next";

const config: NextConfig = {
	typedRoutes: false,
	skipTrailingSlashRedirect: true,
	outputFileTracingRoot: new URL("../../", import.meta.url).pathname,
};

export default config;
