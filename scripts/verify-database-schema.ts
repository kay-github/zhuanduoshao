import { Pool } from 'pg'

import { getProjectDatabaseUrl, loadProjectEnv } from './runtime-env.js'

interface ColumnContract {
  dataType: string
  nullable?: boolean
  maximumLength?: number
  numericPrecision?: number
  numericScale?: number
  defaultPattern?: RegExp
}

interface ColumnRow {
  table_name: string
  column_name: string
  data_type: string
  character_maximum_length: number | null
  numeric_precision: number | null
  numeric_scale: number | null
  is_nullable: 'YES' | 'NO'
  column_default: string | null
}

const uuid = (withRandomDefault = false): ColumnContract => ({
  dataType: 'uuid',
  defaultPattern: withRandomDefault ? /^gen_random_uuid\(\)$/ : undefined,
})
const varchar = (maximumLength: number, nullable = false): ColumnContract => ({
  dataType: 'character varying',
  maximumLength,
  nullable,
})
const numeric = (numericPrecision: number, numericScale: number): ColumnContract => ({
  dataType: 'numeric',
  numericPrecision,
  numericScale,
})
const timestamp = (nullable = false, withNowDefault = false): ColumnContract => ({
  dataType: 'timestamp with time zone',
  nullable,
  defaultPattern: withNowDefault ? /^now\(\)$/ : undefined,
})

const expectedColumns: Record<string, Record<string, ColumnContract>> = {
  users: {
    id: uuid(true),
    username: varchar(24),
    password_hash: { dataType: 'text' },
    created_at: timestamp(false, true),
    updated_at: timestamp(false, true),
  },
  positions: {
    id: uuid(true),
    user_id: uuid(),
    stock_code: varchar(6),
    quantity: numeric(20, 0),
    cost_price: numeric(18, 4),
    basis_date: varchar(10, true),
    created_at: timestamp(false, true),
    updated_at: timestamp(false, true),
  },
  quote_snapshots: {
    stock_code: varchar(6),
    latest_price: numeric(18, 4),
    total_market_cap: numeric(20, 0),
    price_change_pct: numeric(10, 4),
    quote_updated_at: varchar(8),
    quote_as_of: timestamp(true),
    source: varchar(32),
    fetched_at: timestamp(false, true),
  },
  dividend_snapshots: {
    stock_code: varchar(6),
    payload: { dataType: 'text' },
    source: varchar(32),
    fetched_at: timestamp(false, true),
  },
  quote_history: {
    stock_code: varchar(6),
    trade_date: { dataType: 'date' },
    latest_price: numeric(18, 4),
    total_market_cap: numeric(20, 0),
    price_change_pct: numeric(10, 4),
    source: varchar(32),
    fetched_at: timestamp(),
    quote_as_of: timestamp(true),
  },
}

const expectedKeys = [
  { tableName: 'users', columns: ['id'], primary: true },
  { tableName: 'users', columns: ['username'], primary: false },
  { tableName: 'positions', columns: ['id'], primary: true },
  { tableName: 'positions', columns: ['user_id', 'stock_code'], primary: false },
  { tableName: 'quote_snapshots', columns: ['stock_code'], primary: true },
  { tableName: 'dividend_snapshots', columns: ['stock_code'], primary: true },
  { tableName: 'quote_history', columns: ['stock_code', 'trade_date'], primary: true },
] as const

loadProjectEnv()

const databaseUrl = getProjectDatabaseUrl()

if (!databaseUrl) {
  throw new Error('Database URL is not configured. Load the target environment before running db:verify.')
}

const pool = new Pool({ connectionString: databaseUrl, max: 1 })
const tableNames = Object.keys(expectedColumns)

function sameColumns(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((column, index) => column === right[index])
}

try {
  const { rows: columnRows } = await pool.query<ColumnRow>(
    `select table_name,
            column_name,
            data_type,
            character_maximum_length,
            numeric_precision,
            numeric_scale,
            is_nullable,
            column_default
       from information_schema.columns
      where table_schema = 'public'
        and table_name = any($1::text[])`,
    [tableNames],
  )
  const actualColumns = new Map(columnRows.map((row) => [`${row.table_name}.${row.column_name}`, row]))
  const problems: string[] = []

  for (const [tableName, columns] of Object.entries(expectedColumns)) {
    for (const [columnName, contract] of Object.entries(columns)) {
      const path = `${tableName}.${columnName}`
      const actual = actualColumns.get(path)

      if (!actual) {
        problems.push(`${path} is missing`)
        continue
      }

      if (actual.data_type !== contract.dataType) {
        problems.push(`${path} type is ${actual.data_type}, expected ${contract.dataType}`)
      }

      if (actual.is_nullable === 'YES' !== (contract.nullable ?? false)) {
        problems.push(`${path} nullable=${actual.is_nullable}, expected ${contract.nullable ? 'YES' : 'NO'}`)
      }

      if (contract.maximumLength !== undefined && actual.character_maximum_length !== contract.maximumLength) {
        problems.push(`${path} length is ${actual.character_maximum_length}, expected ${contract.maximumLength}`)
      }

      if (contract.numericPrecision !== undefined && actual.numeric_precision !== contract.numericPrecision) {
        problems.push(`${path} precision is ${actual.numeric_precision}, expected ${contract.numericPrecision}`)
      }

      if (contract.numericScale !== undefined && actual.numeric_scale !== contract.numericScale) {
        problems.push(`${path} scale is ${actual.numeric_scale}, expected ${contract.numericScale}`)
      }

      if (contract.defaultPattern && (!actual.column_default || !contract.defaultPattern.test(actual.column_default))) {
        problems.push(`${path} default is ${actual.column_default ?? 'missing'}, expected ${contract.defaultPattern}`)
      }
    }
  }

  const { rows: indexRows } = await pool.query<{
    table_name: string
    is_primary: boolean
    is_unique: boolean
    is_valid: boolean
    is_ready: boolean
    is_immediate: boolean
    is_partial: boolean
    is_expression: boolean
    columns: string[]
  }>(
    `select table_relation.relname as table_name,
            index_info.indisprimary as is_primary,
            index_info.indisunique as is_unique,
            index_info.indisvalid as is_valid,
            index_info.indisready as is_ready,
            index_info.indimmediate as is_immediate,
            (index_info.indpred is not null) as is_partial,
            (index_info.indexprs is not null) as is_expression,
            array_agg(column_info.attname order by indexed_column.ordinality)::text[] as columns
       from pg_catalog.pg_class table_relation
       join pg_catalog.pg_namespace table_namespace
         on table_namespace.oid = table_relation.relnamespace
       join pg_catalog.pg_index index_info
         on index_info.indrelid = table_relation.oid
       cross join lateral unnest(index_info.indkey)
         with ordinality as indexed_column(attnum, ordinality)
       join pg_catalog.pg_attribute column_info
         on column_info.attrelid = table_relation.oid
        and column_info.attnum = indexed_column.attnum
        and indexed_column.ordinality <= index_info.indnkeyatts
      where table_namespace.nspname = 'public'
        and table_relation.relname = any($1::text[])
      group by table_relation.relname,
               index_info.indisprimary,
               index_info.indisunique,
               index_info.indisvalid,
               index_info.indisready,
               index_info.indimmediate,
               index_info.indpred,
               index_info.indexprs,
               index_info.indexrelid`,
    [tableNames],
  )

  for (const expectedKey of expectedKeys) {
    const found = indexRows.some(
      (index) =>
        index.table_name === expectedKey.tableName &&
        index.is_unique &&
        index.is_valid &&
        index.is_ready &&
        index.is_immediate &&
        !index.is_partial &&
        !index.is_expression &&
        index.is_primary === expectedKey.primary &&
        sameColumns(index.columns, expectedKey.columns),
    )

    if (!found) {
      problems.push(
        `${expectedKey.tableName} is missing the expected ${expectedKey.primary ? 'primary' : 'unique'} key (${expectedKey.columns.join(', ')})`,
      )
    }
  }

  const { rows: foreignKeyRows } = await pool.query<{
    table_name: string
    column_name: string
    foreign_table_name: string
    foreign_column_name: string
    delete_rule: string
  }>(
    `select constraints.table_name,
            key_columns.column_name,
            foreign_columns.table_name as foreign_table_name,
            foreign_columns.column_name as foreign_column_name,
            referential.delete_rule
       from information_schema.table_constraints constraints
       join information_schema.key_column_usage key_columns
         on key_columns.constraint_catalog = constraints.constraint_catalog
        and key_columns.constraint_schema = constraints.constraint_schema
        and key_columns.constraint_name = constraints.constraint_name
       join information_schema.referential_constraints referential
         on referential.constraint_catalog = constraints.constraint_catalog
        and referential.constraint_schema = constraints.constraint_schema
        and referential.constraint_name = constraints.constraint_name
       join information_schema.constraint_column_usage foreign_columns
         on foreign_columns.constraint_catalog = referential.unique_constraint_catalog
        and foreign_columns.constraint_schema = referential.unique_constraint_schema
        and foreign_columns.constraint_name = referential.unique_constraint_name
      where constraints.table_schema = 'public'
        and constraints.constraint_type = 'FOREIGN KEY'
        and constraints.table_name = 'positions'`,
  )
  const hasPositionOwnerForeignKey = foreignKeyRows.some(
    (foreignKey) =>
      foreignKey.table_name === 'positions' &&
      foreignKey.column_name === 'user_id' &&
      foreignKey.foreign_table_name === 'users' &&
      foreignKey.foreign_column_name === 'id' &&
      foreignKey.delete_rule === 'CASCADE',
  )

  if (!hasPositionOwnerForeignKey) {
    problems.push('positions.user_id must reference users.id with ON DELETE CASCADE')
  }

  if (problems.length > 0) {
    throw new Error(`Database schema contract mismatch:\n- ${problems.join('\n- ')}`)
  }

  console.log(
    `Database schema verified: ${tableNames.length} tables match required columns, types, nullability, keys, and foreign keys.`,
  )
} finally {
  await pool.end()
}
