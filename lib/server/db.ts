import { neon } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'

import { ConfigurationError } from './errors.js'
import * as schema from './schema.js'

let dbInstance: ReturnType<typeof drizzle<typeof schema>> | null = null

function getDatabaseUrl() {
  const databaseUrl = process.env.POSTGRES_URL ?? process.env.DATABASE_URL

  if (!databaseUrl) {
    throw new ConfigurationError('服务端尚未配置 POSTGRES_URL')
  }

  return databaseUrl
}

export function getDb() {
  if (dbInstance) {
    return dbInstance
  }

  const client = neon(getDatabaseUrl())
  dbInstance = drizzle({ client, schema })
  return dbInstance
}
