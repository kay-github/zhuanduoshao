import { config as loadEnv } from 'dotenv'

import { defineConfig } from 'drizzle-kit'

loadEnv()
loadEnv({ path: '.env.local', override: true })

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
  return (
    readEnvValue('POSTGRES_URL') ??
    readFirstMatchingEnv('_POSTGRES_URL') ??
    readEnvValue('DATABASE_URL') ??
    readFirstMatchingEnv('_DATABASE_URL') ??
    readFirstMatchingEnv('_PRISMA_DATABASE_URL') ??
    ''
  )
}

export default defineConfig({
  out: './drizzle',
  schema: './lib/server/schema.ts',
  dialect: 'postgresql',
  dbCredentials: {
    url: getDatabaseUrl(),
  },
  strict: true,
  verbose: true,
})
