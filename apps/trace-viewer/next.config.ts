import type { NextConfig } from "next";

const config: NextConfig = {
	typedRoutes: false,
	outputFileTracingRoot: new URL("../../", import.meta.url).pathname,
};

export default config;
