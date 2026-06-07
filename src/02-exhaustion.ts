import postgres from 'postgres'
import { DIRECT_URL, POOLER_TX_URL, countBackends, header, info, ok, bad, line, sleep } from './config'

const PODS = Number(process.env.PODS ?? 30)

function isTooManyClients(e: any): boolean {
  const msg = String(e?.message ?? e)
  return e?.code === '53300' ||
    /too many clients|too many connections|remaining connection slots/i.test(msg)
}

async function tryDirect(): Promise<{ ok: boolean; tooMany: boolean }> {
  const sql = postgres(DIRECT_URL, { max: 1, connect_timeout: 10, idle_timeout: 2 })
  try {
    await sql`select 1`
    await sleep(300) // tahan koneksi sebentar supaya saling rebutan slot
    return { ok: true, tooMany: false }
  } catch (e) {
    return { ok: false, tooMany: isTooManyClients(e) }
  } finally {
    await sql.end({ timeout: 5 }).catch(() => {})
  }
}

header('Skenario 2 — Exhaustion vs PgBouncer (Slide 10 & 13)')
info(`Postgres di-set max_connections=20. Simulasikan ${PODS} "pod" konek bersamaan.`)

line()
info(`MODE DIRECT — ${PODS} koneksi langsung ke Postgres (5433):`)
const direct = await Promise.all(Array.from({ length: PODS }, () => tryDirect()))
const dOk = direct.filter((r) => r.ok).length
const dTooMany = direct.filter((r) => r.tooMany).length
ok(`sukses: ${dOk}`)
bad(`gagal : ${direct.length - dOk}  (di antaranya "too many clients": ${dTooMany})`)

line()
info(`MODE POOLER — ${PODS} koneksi lewat PgBouncer transaction mode (6432):`)
const pooled = Array.from({ length: PODS }, () => {
  const sql = postgres(POOLER_TX_URL, { max: 1, connect_timeout: 10 })
  return sql`select pg_sleep(0.4)`
    .then(() => ({ ok: true }))
    .catch((e: any) => ({ ok: false, err: String(e?.message ?? e) }))
    .finally(() => { void sql.end({ timeout: 5 }).catch(() => {}) })
})
await sleep(200)
const liveBackends = await countBackends()
const pooledResults = await Promise.all(pooled)
const pOk = pooledResults.filter((r) => r.ok).length
ok(`sukses: ${pOk}`)
if (pOk < PODS) bad(`gagal : ${PODS - pOk}`)
ok(`koneksi NYATA ke Postgres saat ${PODS} pod aktif: ~${liveBackends} (dibatasi default_pool_size=5)`)

line()
info('Penskalaan aplikasi (jumlah pod) dipisahkan dari jumlah koneksi database.')
