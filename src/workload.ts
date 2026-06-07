import postgres from 'postgres'
import { ok, bad, info } from './config'

export type Result = { success: number; failed: number; firstError: string; present: number }

// Prepared statement workload (Slide 18): PREPARE di satu transaksi, EXECUTE di
// transaksi berikutnya, di-pin ke SATU koneksi postgres.js via reserve().
// - session mode  → koneksi server sama sepanjang sesi → sukses
// - transaction mode → pgbouncer bisa kasih server berbeda per transaksi → error 26000
export async function preparedWorkload(url: string, ops: number): Promise<Result> {
  const sql = postgres(url, { max: 5, prepare: false, onnotice: () => {} })
  let success = 0
  let failed = 0
  let firstError = ''
  const tasks = Array.from({ length: ops }, (_, i) => (async () => {
    const name = `stmt_${i}`
    const conn = await sql.reserve()
    try {
      await conn.unsafe(`PREPARE ${name} AS INSERT INTO notes (body) VALUES ($1) RETURNING id`)
      await conn.unsafe(`EXECUTE ${name}('note-${i}')`)
      success++
    } catch (e: any) {
      failed++
      if (!firstError) firstError = `${e?.code ?? ''} ${e?.message ?? e}`.trim()
    } finally {
      conn.release()
    }
  })())
  await Promise.all(tasks)
  const [{ n }] = await sql`select count(*)::int as n from notes`
  await sql.end({ timeout: 5 })
  return { success, failed, firstError, present: n as number }
}

// Fix (Slide 19): tanpa prepared statement — query dikirim langsung tiap kali,
// jadi tidak bergantung pada koneksi server tertentu.
export async function plainWorkload(url: string, ops: number): Promise<Result> {
  const sql = postgres(url, { max: 5, prepare: false, onnotice: () => {} })
  let success = 0
  let failed = 0
  let firstError = ''
  const tasks = Array.from({ length: ops }, (_, i) =>
    sql`insert into notes (body) values (${'note-' + i}) returning id`
      .then(() => { success++ })
      .catch((e: any) => {
        failed++
        if (!firstError) firstError = `${e?.code ?? ''} ${e?.message ?? e}`.trim()
      }),
  )
  await Promise.all(tasks)
  const [{ n }] = await sql`select count(*)::int as n from notes`
  await sql.end({ timeout: 5 })
  return { success, failed, firstError, present: n as number }
}

export function reportWorkload(r: Result, ops: number) {
  if (r.failed > 0) bad(`sukses ${r.success}/${ops}, gagal ${r.failed} → ${r.firstError}`)
  else ok(`sukses ${r.success}/${ops}, gagal 0`)
  info(`baris tersimpan: ${r.present}`)
}
