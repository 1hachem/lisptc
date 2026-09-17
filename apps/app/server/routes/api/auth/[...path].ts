import { defineHandler } from "nitro";
import { authHandler } from "../../../auth.ts";

export default defineHandler((event) => authHandler(event.req));
