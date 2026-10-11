import { errors } from "./error.ts";
import { logged } from "./log.ts";
import { telemetry } from "./telemetry.ts";

export const edge = [telemetry, logged, errors] as const;
