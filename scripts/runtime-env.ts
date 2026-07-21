import { config as loadEnv } from 'dotenv'

import { DISABLE_MARKET_DATA_PERSISTENCE_ENV } from '../lib/server/market-data-persistence.js'

export function loadProjectEnv() {
  loadEnv({ quiet: true })
  loadEnv({ path: '.env.local', override: true, quiet: true })
}

function readEnvValue(name: string) {
  const value = process.env[name]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function readFirstMatchingEnv(suffix: string) {
  const matchedName = Object.keys(process.env)
    .sort()
    .find((name) => name.endsWith(suffix) && readEnvValue(name))

  return matchedName ? readEnvValue(matchedName) : null
}

export function getProjectDatabaseUrl() {
  return (
    readEnvValue('POSTGRES_URL') ??
    readFirstMatchingEnv('_POSTGRES_URL') ??
    readEnvValue('DATABASE_URL') ??
    readFirstMatchingEnv('_DATABASE_URL') ??
    readFirstMatchingEnv('_PRISMA_DATABASE_URL')
  )
}

export function disableDatabaseForCurrentProcess() {
  process.env[DISABLE_MARKET_DATA_PERSISTENCE_ENV] = '1'

  for (const name of Object.keys(process.env)) {
    if (
      name === 'POSTGRES_URL' ||
      name === 'DATABASE_URL' ||
      name.endsWith('_POSTGRES_URL') ||
      name.endsWith('_DATABASE_URL') ||
      name.endsWith('_PRISMA_DATABASE_URL')
    ) {
      delete process.env[name]
    }
  }
}
