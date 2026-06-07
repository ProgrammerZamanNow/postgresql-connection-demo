import postgres from 'postgres'

export const DIRECT_URL =
  process.env.DIRECT_URL ?? 'postgres://demo:demo@localhost:5433/demo'
export const POOLER_TX_URL =
  process.env.POOLER_TX_URL ?? 'postgres://demo:demo@localhost:6432/demo_tx'
export const POOLER_SESSION_URL =
  process.env.POOLER_SESSION_URL ?? 'postgres://demo:demo@localhost:6432/demo_session'

export const POSTGRES_CONTAINER = process.env.POSTGRES_CONTAINER ?? 'demo-postgres'

const BAR = '─'.repeat(64)
export function header(title: string) {
  console.log('\n' + BAR)
  console.log('  ' + title)
  console.log(BAR)
}
export function line(msg = '') { console.log(msg) }
export function ok(msg: string) { console.log('  ✅ ' + msg) }
export function bad(msg: string) { console.log('  ❌ ' + msg) }
export function info(msg: string) { console.log('  •  ' + msg) }

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

// Count live client backends on the demo database, observed directly on Postgres.
export async function countBackends(): Promise<number> {
  const sql = postgres(DIRECT_URL, { max: 1 })
  try {
    const rows = await sql`
      select count(*)::int as n
      from pg_stat_activity
      where datname = 'demo' and backend_type = 'client backend'
    `
    return rows[0].n as number
  } finally {
    await sql.end({ timeout: 5 })
  }
}

// Ensure the notes table exists and is empty.
export async function resetSchema(): Promise<void> {
  const sql = postgres(DIRECT_URL, { max: 1, onnotice: () => {} })
  try {
    await sql`create table if not exists notes (id serial primary key, body text)`
    await sql`truncate notes restart identity`
  } finally {
    await sql.end({ timeout: 5 })
  }
}
