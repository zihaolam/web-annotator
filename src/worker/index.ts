import { createApp } from "./app";
import { createD1Database } from "./db/client";

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  ADMIN_TOKEN?: string;
}

export default {
  async fetch(request, env): Promise<Response> {
    const app = createApp({ db: createD1Database(env.DB), adminToken: env.ADMIN_TOKEN });
    return (await app(request)) ?? env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
