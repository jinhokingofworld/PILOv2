import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  generateSqlErdSchema
} = require("../../dist/modules/sql-erd/sql-erd-schema-generator.js");

export function generateDatabaseFixture(requestedDialect) {
  return generateSqlErdSchema({
    version: 1,
    title: "Schema generator database fixture",
    requestedDialect,
    tables: [
      {
        key: "children",
        name: "schema_generator_children",
        schemaName: null,
        columns: [
          createBigintColumn("id", false),
          createBigintColumn("parent_id", true)
        ],
        primaryKey: { name: null, columnKeys: ["id"] },
        uniqueConstraints: []
      },
      {
        key: "parents",
        name: "schema_generator_parents",
        schemaName: null,
        columns: [
          createBigintColumn("id", false),
          createBigintColumn("favorite_child_id", true)
        ],
        primaryKey: { name: null, columnKeys: ["id"] },
        uniqueConstraints: []
      }
    ],
    relations: [
      {
        key: "children_parent",
        name: "fk_schema_generator_children_parent",
        fromTableKey: "children",
        fromColumnKeys: ["parent_id"],
        toTableKey: "parents",
        toColumnKeys: ["id"]
      },
      {
        key: "parents_favorite_child",
        name: "fk_schema_generator_parents_favorite_child",
        fromTableKey: "parents",
        fromColumnKeys: ["favorite_child_id"],
        toTableKey: "children",
        toColumnKeys: ["id"]
      }
    ],
    unsupportedFeatures: []
  });
}

function createBigintColumn(key, nullable) {
  return {
    key,
    name: key,
    dataType: {
      kind: "bigint",
      length: null,
      precision: null,
      scale: null
    },
    nullable,
    autoIncrement: false,
    defaultValue: null
  };
}
