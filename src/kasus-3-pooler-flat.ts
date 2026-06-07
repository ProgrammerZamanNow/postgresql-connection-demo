import postgres from 'postgres'
import { POOLER_TX_URL, countBackends, header, info, ok, line, sleep } from './config'

const PODS = Number(process.env.PODS ?? 30)

header('KASUS 3 — PgBouncer: banyak di depan, sedikit di belakang (Slide 13)')
info(`${PODS} "pod" yang sama konek lewat PgBouncer transaction mode (6432).`)
line()

const pooled = Array.from({ length: PODS }, () => {
  const sql = postgres(POOLER_TX_URL, { max: 1, connect_timeout: 10 })
  return sql`select pg_sleep(0.4)`
    .then(() => ({ ok: true }))
    .catch((e: any) => ({ ok: false, err: String(e?.message ?? e) }))
    .finally(() => { void sql.end({ timeout: 5 }).catch(() => {}) })
})
await sleep(200)
const liveBackends = await countBackends()
const results = await Promise.all(pooled)
const okN = results.filter((r) => r.ok).length

ok(`sukses: ${okN}/${PODS} (semua lolos — pool penuh = ngantri, bukan error)`)
ok(`koneksi NYATA ke Postgres saat ${PODS} pod aktif: ~${liveBackends} (dibatasi default_pool_size=5)`)
line()
info('Penskalaan aplikasi (jumlah pod) dipisahkan dari jumlah koneksi database.')
