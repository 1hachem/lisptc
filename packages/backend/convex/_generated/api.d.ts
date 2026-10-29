/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as auth from "../auth.js";
import type * as bin from "../bin.js";
import type * as chats from "../chats.js";
import type * as crons from "../crons.js";
import type * as desktops from "../desktops.js";
import type * as files from "../files.js";
import type * as http from "../http.js";
import type * as layouts from "../layouts.js";
import type * as lib_acting from "../lib/acting.js";
import type * as lib_attached from "../lib/attached.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_bin from "../lib/bin.js";
import type * as lib_chunks from "../lib/chunks.js";
import type * as lib_claimed from "../lib/claimed.js";
import type * as lib_clamp from "../lib/clamp.js";
import type * as lib_env from "../lib/env.js";
import type * as lib_files from "../lib/files.js";
import type * as lib_names from "../lib/names.js";
import type * as lib_preferenceDefaults from "../lib/preferenceDefaults.js";
import type * as lib_slug from "../lib/slug.js";
import type * as lib_stored from "../lib/stored.js";
import type * as lib_waiting from "../lib/waiting.js";
import type * as lib_workspaceIcons from "../lib/workspaceIcons.js";
import type * as limits from "../limits.js";
import type * as memories from "../memories.js";
import type * as messages from "../messages.js";
import type * as migrations from "../migrations.js";
import type * as oauth from "../oauth.js";
import type * as permissions from "../permissions.js";
import type * as posthog from "../posthog.js";
import type * as preferences from "../preferences.js";
import type * as readmes from "../readmes.js";
import type * as repls from "../repls.js";
import type * as secrets from "../secrets.js";
import type * as sources from "../sources.js";
import type * as threads from "../threads.js";
import type * as uploads from "../uploads.js";
import type * as users from "../users.js";
import type * as workspaces from "../workspaces.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  bin: typeof bin;
  chats: typeof chats;
  crons: typeof crons;
  desktops: typeof desktops;
  files: typeof files;
  http: typeof http;
  layouts: typeof layouts;
  "lib/acting": typeof lib_acting;
  "lib/attached": typeof lib_attached;
  "lib/auth": typeof lib_auth;
  "lib/bin": typeof lib_bin;
  "lib/chunks": typeof lib_chunks;
  "lib/claimed": typeof lib_claimed;
  "lib/clamp": typeof lib_clamp;
  "lib/env": typeof lib_env;
  "lib/files": typeof lib_files;
  "lib/names": typeof lib_names;
  "lib/preferenceDefaults": typeof lib_preferenceDefaults;
  "lib/slug": typeof lib_slug;
  "lib/stored": typeof lib_stored;
  "lib/waiting": typeof lib_waiting;
  "lib/workspaceIcons": typeof lib_workspaceIcons;
  limits: typeof limits;
  memories: typeof memories;
  messages: typeof messages;
  migrations: typeof migrations;
  oauth: typeof oauth;
  permissions: typeof permissions;
  posthog: typeof posthog;
  preferences: typeof preferences;
  readmes: typeof readmes;
  repls: typeof repls;
  secrets: typeof secrets;
  sources: typeof sources;
  threads: typeof threads;
  uploads: typeof uploads;
  users: typeof users;
  workspaces: typeof workspaces;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  betterAuth: import("@convex-dev/better-auth/_generated/component.js").ComponentApi<"betterAuth">;
  migrations: import("@convex-dev/migrations/_generated/component.js").ComponentApi<"migrations">;
  posthog: import("@posthog/convex/_generated/component.js").ComponentApi<"posthog">;
};
