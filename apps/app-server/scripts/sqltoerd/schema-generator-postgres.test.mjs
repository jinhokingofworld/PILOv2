import assert from "node:assert/strict";
import pg from "pg";
import { generateDatabaseFixture } from "./schema-generator-database-fixture.mjs";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required for schema generator PostgreSQL test");
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();
const schemaName = `schema_generator_test_${process.pid}`;

try {
  await client.query("BEGIN");
  await client.query(`CREATE SCHEMA "${schemaName}"`);
  await client.query(`SET LOCAL search_path TO "${schemaName}"`);
  await client.query(generateDatabaseFixture("postgresql").sourceText);
  const result = await client.query(
    `SELECT count(*)::integer AS count
       FROM pg_constraint constraint_row
       JOIN pg_namespace namespace_row
         ON namespace_row.oid = constraint_row.connamespace
      WHERE namespace_row.nspname = $1
        AND constraint_row.contype = 'f'`,
    [schemaName]
  );
  assert.equal(result.rows[0].count, 2);
  await client.query("ROLLBACK");
  console.log("SQLtoERD schema generator PostgreSQL DDL test passed.");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
