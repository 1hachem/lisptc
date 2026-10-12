import { AsyncLocalStorage } from "node:async_hooks";
import { format } from "node:util";
import { type Logger, SeverityNumber } from "@opentelemetry/api-logs";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
	BatchLogRecordProcessor,
	LoggerProvider,
} from "@opentelemetry/sdk-logs";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import { analyticsEnv } from "@repo/env/analytics";

const SERVICE_NAME = "app";
const ATTR_DEPLOYMENT_ENVIRONMENT_NAME = "deployment.environment.name";

const LEVELS = {
	debug: SeverityNumber.DEBUG,
	log: SeverityNumber.INFO,
	info: SeverityNumber.INFO,
	warn: SeverityNumber.WARN,
	error: SeverityNumber.ERROR,
} as const satisfies Record<string, SeverityNumber>;

export interface LogContext {
	distinctId?: string;
	sessionId?: string;
}

interface LogsGlobals {
	__lisptcLogs?: LoggerProvider | null;
	__lisptcLogContext?: AsyncLocalStorage<LogContext>;
}

const globals = globalThis as typeof globalThis & LogsGlobals;

globals.__lisptcLogContext ??= new AsyncLocalStorage<LogContext>();
const context = globals.__lisptcLogContext;

export function withLogContext<T>(ctx: LogContext, fn: () => T): T {
	return context.run(ctx, fn);
}

function contextAttributes(): Record<string, string> {
	const current = context.getStore();
	return {
		...(current?.distinctId ? { posthogDistinctId: current.distinctId } : {}),
		...(current?.sessionId ? { sessionId: current.sessionId } : {}),
	};
}

function provider(token: string): LoggerProvider {
	const host = analyticsEnv.POSTHOG_HOST ?? "https://us.i.posthog.com";
	return new LoggerProvider({
		resource: resourceFromAttributes({
			[ATTR_SERVICE_NAME]: SERVICE_NAME,
			...(analyticsEnv.POSTHOG_ENVIRONMENT
				? {
						[ATTR_DEPLOYMENT_ENVIRONMENT_NAME]:
							analyticsEnv.POSTHOG_ENVIRONMENT,
					}
				: {}),
		}),
		processors: [
			new BatchLogRecordProcessor({
				exporter: new OTLPLogExporter({
					url: new URL("/i/v1/logs", host).toString(),
					headers: { Authorization: `Bearer ${token}` },
				}),
			}),
		],
	});
}

function mirror(logger: Logger): void {
	for (const [level, severityNumber] of Object.entries(LEVELS)) {
		const method = level as keyof typeof LEVELS;
		const original = console[method].bind(console);
		console[method] = (...args: unknown[]) => {
			original(...args);
			logger.emit({
				severityNumber,
				severityText: method === "log" ? "INFO" : method.toUpperCase(),
				body: format(...args),
				attributes: contextAttributes(),
			});
		};
	}
}

export function startLogs(): void {
	if (globals.__lisptcLogs !== undefined) return;
	const token = analyticsEnv.POSTHOG_API_KEY;
	if (!token) {
		globals.__lisptcLogs = null;
		console.log("[logs] POSTHOG_API_KEY unset, logs stay local");
		return;
	}
	const logs = provider(token);
	globals.__lisptcLogs = logs;
	mirror(logs.getLogger(SERVICE_NAME));
}

export async function shutdownLogs(): Promise<void> {
	await globals.__lisptcLogs?.shutdown();
}
