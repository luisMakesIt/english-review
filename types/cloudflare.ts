/**
 * Cloudflare Pages Function Types
 */

import type { D1Database } from "@cloudflare/workers-types";

export interface Env {
  ASSETS: {
    fetch: typeof fetch;
  };
  DB: D1Database;
}

export type APIRoute = PagesFunction<Env>;
