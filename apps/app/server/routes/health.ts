import { defineHandler } from "nitro";
import agent from "../agent/app.ts";

export default defineHandler((event) => agent.fetch(event.req));
