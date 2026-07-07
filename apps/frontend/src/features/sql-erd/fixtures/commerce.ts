import {
  SQLTOERD_LAYOUT_JSON_VERSION,
  SQLTOERD_MODEL_JSON_VERSION,
  type SqltoerdSessionFixture
} from "@/features/sql-erd/types";

export const commerceSqltoerdFixture: SqltoerdSessionFixture = {
  title: "Commerce ERD",
  sourceFormat: "sql",
  dialect: "postgresql",
  sourceText: `CREATE TABLE users (
  id BIGINT PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  full_name VARCHAR(120),
  created_at TIMESTAMP NOT NULL
);

CREATE TABLE addresses (
  id BIGINT PRIMARY KEY,
  user_id BIGINT NOT NULL,
  line1 VARCHAR(255) NOT NULL,
  city VARCHAR(80) NOT NULL,
  country CHAR(2) NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE products (
  id BIGINT PRIMARY KEY,
  sku VARCHAR(64) NOT NULL UNIQUE,
  name VARCHAR(200) NOT NULL,
  price_cents INT NOT NULL,
  active BOOLEAN NOT NULL
);

CREATE TABLE orders (
  id BIGINT PRIMARY KEY,
  user_id BIGINT NOT NULL,
  address_id BIGINT,
  status VARCHAR(32) NOT NULL,
  total_cents INT NOT NULL,
  placed_at TIMESTAMP NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (address_id) REFERENCES addresses(id)
);

CREATE TABLE order_items (
  id BIGINT PRIMARY KEY,
  order_id BIGINT NOT NULL,
  product_id BIGINT NOT NULL,
  quantity INT NOT NULL,
  unit_cents INT NOT NULL,
  CONSTRAINT fk_oi_order FOREIGN KEY (order_id) REFERENCES orders(id),
  CONSTRAINT fk_oi_product FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE TABLE reviews (
  id BIGINT PRIMARY KEY,
  product_id BIGINT NOT NULL REFERENCES products(id),
  user_id BIGINT NOT NULL REFERENCES users(id),
  rating SMALLINT NOT NULL,
  body TEXT,
  created_at TIMESTAMP NOT NULL
);`,
  modelJson: {
    version: SQLTOERD_MODEL_JSON_VERSION,
    schema: {
      tables: [
        {
          id: "table.users",
          name: "users",
          schemaName: null,
          columns: [
            createColumn("column.users.id", "id", "BIGINT", {
              nullable: false,
              primaryKey: true
            }),
            createColumn("column.users.email", "email", "VARCHAR(255)", {
              nullable: false,
              unique: true
            }),
            createColumn("column.users.full_name", "full_name", "VARCHAR(120)"),
            createColumn("column.users.created_at", "created_at", "TIMESTAMP", {
              nullable: false
            })
          ],
          constraints: [
            {
              id: "constraint.users.pk",
              kind: "primary_key",
              columnIds: ["column.users.id"],
              name: null
            },
            {
              id: "constraint.users.email.unique",
              kind: "unique",
              columnIds: ["column.users.email"],
              name: null
            }
          ],
          comment: null
        },
        {
          id: "table.addresses",
          name: "addresses",
          schemaName: null,
          columns: [
            createColumn("column.addresses.id", "id", "BIGINT", {
              nullable: false,
              primaryKey: true
            }),
            createColumn("column.addresses.user_id", "user_id", "BIGINT", {
              nullable: false,
              foreignKey: true
            }),
            createColumn("column.addresses.line1", "line1", "VARCHAR(255)", {
              nullable: false
            }),
            createColumn("column.addresses.city", "city", "VARCHAR(80)", {
              nullable: false
            }),
            createColumn("column.addresses.country", "country", "CHAR(2)", {
              nullable: false
            })
          ],
          constraints: [
            {
              id: "constraint.addresses.pk",
              kind: "primary_key",
              columnIds: ["column.addresses.id"],
              name: null
            }
          ],
          comment: null
        },
        {
          id: "table.products",
          name: "products",
          schemaName: null,
          columns: [
            createColumn("column.products.id", "id", "BIGINT", {
              nullable: false,
              primaryKey: true
            }),
            createColumn("column.products.sku", "sku", "VARCHAR(64)", {
              nullable: false,
              unique: true
            }),
            createColumn("column.products.name", "name", "VARCHAR(200)", {
              nullable: false
            }),
            createColumn("column.products.price_cents", "price_cents", "INT", {
              nullable: false
            }),
            createColumn("column.products.active", "active", "BOOLEAN", {
              nullable: false
            })
          ],
          constraints: [
            {
              id: "constraint.products.pk",
              kind: "primary_key",
              columnIds: ["column.products.id"],
              name: null
            },
            {
              id: "constraint.products.sku.unique",
              kind: "unique",
              columnIds: ["column.products.sku"],
              name: null
            }
          ],
          comment: null
        },
        {
          id: "table.orders",
          name: "orders",
          schemaName: null,
          columns: [
            createColumn("column.orders.id", "id", "BIGINT", {
              nullable: false,
              primaryKey: true
            }),
            createColumn("column.orders.user_id", "user_id", "BIGINT", {
              nullable: false,
              foreignKey: true
            }),
            createColumn("column.orders.address_id", "address_id", "BIGINT", {
              foreignKey: true
            }),
            createColumn("column.orders.status", "status", "VARCHAR(32)", {
              nullable: false
            }),
            createColumn("column.orders.total_cents", "total_cents", "INT", {
              nullable: false
            }),
            createColumn("column.orders.placed_at", "placed_at", "TIMESTAMP", {
              nullable: false
            })
          ],
          constraints: [
            {
              id: "constraint.orders.pk",
              kind: "primary_key",
              columnIds: ["column.orders.id"],
              name: null
            }
          ],
          comment: null
        },
        {
          id: "table.order_items",
          name: "order_items",
          schemaName: null,
          columns: [
            createColumn("column.order_items.id", "id", "BIGINT", {
              nullable: false,
              primaryKey: true
            }),
            createColumn("column.order_items.order_id", "order_id", "BIGINT", {
              nullable: false,
              foreignKey: true
            }),
            createColumn(
              "column.order_items.product_id",
              "product_id",
              "BIGINT",
              {
                nullable: false,
                foreignKey: true
              }
            ),
            createColumn("column.order_items.quantity", "quantity", "INT", {
              nullable: false
            }),
            createColumn("column.order_items.unit_cents", "unit_cents", "INT", {
              nullable: false
            })
          ],
          constraints: [
            {
              id: "constraint.order_items.pk",
              kind: "primary_key",
              columnIds: ["column.order_items.id"],
              name: null
            }
          ],
          comment: null
        },
        {
          id: "table.reviews",
          name: "reviews",
          schemaName: null,
          columns: [
            createColumn("column.reviews.id", "id", "BIGINT", {
              nullable: false,
              primaryKey: true
            }),
            createColumn("column.reviews.product_id", "product_id", "BIGINT", {
              nullable: false,
              foreignKey: true
            }),
            createColumn("column.reviews.user_id", "user_id", "BIGINT", {
              nullable: false,
              foreignKey: true
            }),
            createColumn("column.reviews.rating", "rating", "SMALLINT", {
              nullable: false
            }),
            createColumn("column.reviews.body", "body", "TEXT"),
            createColumn("column.reviews.created_at", "created_at", "TIMESTAMP", {
              nullable: false
            })
          ],
          constraints: [
            {
              id: "constraint.reviews.pk",
              kind: "primary_key",
              columnIds: ["column.reviews.id"],
              name: null
            }
          ],
          comment: null
        }
      ],
      relations: [
        createForeignKeyRelation(
          "relation.addresses.user_id.users.id",
          "table.addresses",
          ["column.addresses.user_id"],
          "table.users",
          ["column.users.id"]
        ),
        createForeignKeyRelation(
          "relation.orders.user_id.users.id",
          "table.orders",
          ["column.orders.user_id"],
          "table.users",
          ["column.users.id"]
        ),
        createForeignKeyRelation(
          "relation.orders.address_id.addresses.id",
          "table.orders",
          ["column.orders.address_id"],
          "table.addresses",
          ["column.addresses.id"]
        ),
        createForeignKeyRelation(
          "relation.order_items.order_id.orders.id",
          "table.order_items",
          ["column.order_items.order_id"],
          "table.orders",
          ["column.orders.id"],
          "fk_oi_order"
        ),
        createForeignKeyRelation(
          "relation.order_items.product_id.products.id",
          "table.order_items",
          ["column.order_items.product_id"],
          "table.products",
          ["column.products.id"],
          "fk_oi_product"
        ),
        createForeignKeyRelation(
          "relation.reviews.product_id.products.id",
          "table.reviews",
          ["column.reviews.product_id"],
          "table.products",
          ["column.products.id"]
        ),
        createForeignKeyRelation(
          "relation.reviews.user_id.users.id",
          "table.reviews",
          ["column.reviews.user_id"],
          "table.users",
          ["column.users.id"]
        )
      ]
    }
  },
  layoutJson: {
    version: SQLTOERD_LAYOUT_JSON_VERSION,
    tableLayouts: [
      { tableId: "table.users", x: 80, y: 80, width: 260 },
      { tableId: "table.addresses", x: 80, y: 360, width: 280 },
      { tableId: "table.products", x: 430, y: 80, width: 280 },
      { tableId: "table.orders", x: 430, y: 360, width: 280 },
      { tableId: "table.order_items", x: 780, y: 360, width: 300 },
      { tableId: "table.reviews", x: 780, y: 80, width: 280 }
    ],
    viewport: {
      x: 0,
      y: 0,
      zoom: 1
    }
  },
  settingsJson: {}
};

type ColumnOptions = {
  nullable?: boolean;
  primaryKey?: boolean;
  foreignKey?: boolean;
  unique?: boolean;
  defaultValue?: string | null;
  comment?: string | null;
};

function createColumn(
  id: string,
  name: string,
  dataType: string,
  options: ColumnOptions = {}
) {
  return {
    id,
    name,
    dataType,
    nullable: options.nullable ?? true,
    primaryKey: options.primaryKey ?? false,
    foreignKey: options.foreignKey ?? false,
    unique: options.unique ?? false,
    defaultValue: options.defaultValue ?? null,
    comment: options.comment ?? null
  };
}

function createForeignKeyRelation(
  id: string,
  fromTableId: string,
  fromColumnIds: string[],
  toTableId: string,
  toColumnIds: string[],
  constraintName: string | null = null
) {
  return {
    id,
    kind: "foreign_key" as const,
    fromTableId,
    fromColumnIds,
    toTableId,
    toColumnIds,
    constraintName
  };
}
