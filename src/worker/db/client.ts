import { drizzle } from "drizzle-orm/d1";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import * as schema from "./schema";

/**
 * Any SQLite-flavoured Drizzle database carrying our schema. In production this
 * is D1; tests run the same handlers against `bun:sqlite`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Database = BaseSQLiteDatabase<"async" | "sync", any, typeof schema>;

export const createD1Database = (d1: D1Database): Database => drizzle(d1, { schema });

export { schema };
