import assert from "node:assert/strict";
import mysql from "mysql2/promise";
import { generateDatabaseFixture } from "./schema-generator-database-fixture.mjs";

if (!process.env.MYSQL_TEST_URL) {
  throw new Error("MYSQL_TEST_URL is required for schema generator MySQL test");
}

const connectionUrl = new URL(process.env.MYSQL_TEST_URL);
const database = connectionUrl.pathname.replace(/^\//, "");
const connection = await mysql.createConnection({
  host: connectionUrl.hostname,
  port: connectionUrl.port ? Number(connectionUrl.port) : 3306,
  user: decodeURIComponent(connectionUrl.username),
  password: decodeURIComponent(connectionUrl.password),
  database,
  multipleStatements: true
});

try {
  await dropFixtureTables(connection);
  await connection.query(generateDatabaseFixture("mysql").sourceText);
  const [rows] = await connection.query(
    `SELECT count(*) AS count
       FROM information_schema.REFERENTIAL_CONSTRAINTS
      WHERE CONSTRAINT_SCHEMA = ?
        AND TABLE_NAME IN (
          'schema_generator_children',
          'schema_generator_parents'
        )`,
    [database]
  );
  assert.equal(Number(rows[0].count), 2);
  console.log("SQLtoERD schema generator MySQL DDL test passed.");
} finally {
  await dropFixtureTables(connection);
  await connection.end();
}

async function dropFixtureTables(activeConnection) {
  await activeConnection.query(`
    SET FOREIGN_KEY_CHECKS = 0;
    DROP TABLE IF EXISTS schema_generator_children;
    DROP TABLE IF EXISTS schema_generator_parents;
    SET FOREIGN_KEY_CHECKS = 1;
  `);
}
