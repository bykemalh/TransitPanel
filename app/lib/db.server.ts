import pg from "pg";
import fs from "fs";
import path from "path";

const { Pool } = pg;

const connectionString =
  process.env.DATABASE_URL ||
  "postgresql://postgres:jycmgxlbjbrszuaf@localhost:5435/postgres";

// Global pool instance to prevent multiple connections in dev mode (HMR)
declare global {
  var __dbPool: pg.Pool | undefined;
  var __dbInitialized: boolean | undefined;
}

export const pool =
  globalThis.__dbPool ||
  new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });

if (process.env.NODE_NODE_ENV !== "production") {
  globalThis.__dbPool = pool;
}

export async function query<T extends pg.QueryResultRow = any>(text: string, params?: any[]): Promise<pg.QueryResult<T>> {
  await ensureSchemaInitialized();
  return pool.query<T>(text, params);
}

let isInitializing = false;

export async function ensureSchemaInitialized() {
  if (globalThis.__dbInitialized) return;
  if (isInitializing) return;

  isInitializing = true;
  try {
    // Check if country table exists
    const checkRes = await pool.query(
      `SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = 'country'
      );`
    );

    if (!checkRes.rows[0].exists) {
      console.log("Initializing database schema from transitjson-schema.sql...");
      const sqlPath = path.join(process.cwd(), "transitjson-schema.sql");
      if (fs.existsSync(sqlPath)) {
        const sql = fs.readFileSync(sqlPath, "utf-8");
        await pool.query(sql);
        console.log("Database schema initialized successfully.");
      }
    }
    globalThis.__dbInitialized = true;
  } catch (err) {
    console.error("Error during DB schema initialization:", err);
  } finally {
    isInitializing = false;
  }
}

export async function testDbConnection() {
  try {
    const res = await pool.query("SELECT NOW(), PostGIS_Full_Version()");
    return { success: true, serverTime: res.rows[0].now, postgis: res.rows[0].postgis_full_version };
  } catch (err: any) {
    return { success: false, error: err.message || String(err) };
  }
}
