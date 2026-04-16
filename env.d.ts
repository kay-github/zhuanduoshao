declare namespace NodeJS {
  interface ProcessEnv {
    AUTH_SECRET?: string
    DATABASE_URL?: string
    POSTGRES_URL?: string
  }
}
