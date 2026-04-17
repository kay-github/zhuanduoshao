import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool, type PoolConfig } from 'pg'

import { ConfigurationError } from './errors.js'
import * as schema from './schema.js'

let dbInstance: ReturnType<typeof drizzle<typeof schema>> | null = null
let poolInstance: Pool | null = null

function readEnvValue(name: string) {
  const value = process.env[name]

  if (typeof value !== 'string') {
    return null
  }

  const trimmedValue = value.trim()
  return trimmedValue ? trimmedValue : null
}

function readFirstMatchingEnv(suffix: string) {
  const matchedName = Object.keys(process.env)
    .sort()
    .find((name) => name.endsWith(suffix) && readEnvValue(name))

  return matchedName ? readEnvValue(matchedName) : null
}

function getDatabaseUrl() {
  const databaseUrl =
    readEnvValue('POSTGRES_URL') ??
    readFirstMatchingEnv('_POSTGRES_URL') ??
    readEnvValue('DATABASE_URL') ??
    readFirstMatchingEnv('_DATABASE_URL') ??
    readFirstMatchingEnv('_PRISMA_DATABASE_URL')

  if (!databaseUrl) {
    throw new ConfigurationError('服务端尚未配置数据库连接，请检查 POSTGRES_URL 或已连接的 Vercel Postgres 变量')
  }

  return databaseUrl
}

export function getDb() {
  if (dbInstance) {
    return dbInstance
  }

  poolInstance ??= new Pool(getPoolConfig())
  dbInstance = drizzle({ client: poolInstance, schema })
  return dbInstance
}

function getPoolConfig(): PoolConfig {
  return {
    connectionString: getDatabaseUrl(),
    max: 1,
  }
}
