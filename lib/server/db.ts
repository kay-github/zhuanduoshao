import { neon } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'

import * as schema from './schema'

function getDatabaseUrl() {
  const databaseUrl = process.env.POSTGRES_URL ?? process.env.DATABASE_URL

  if (!databaseUrl) {
    throw new Error('POSTGRES_URL or DATABASE_URL is required')
  }

  return databaseUrl
}

const client = neon(getDatabaseUrl())

export const db = drizzle({ client, schema })
