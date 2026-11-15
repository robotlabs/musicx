import { PCloudError } from '../lib/pcloud'

/** Gli errori di pCloud più probabili, in italiano; per gli altri vale il testo originale. */
const known: Record<number, string> = {
  2065: 'Questa playlist non esiste più.',
  2073: 'Esiste già una playlist con questo nome.',
  2008: 'Spazio pCloud esaurito.',
}

export function errorText(error: unknown): string {
  if (error instanceof PCloudError) return known[error.code] ?? error.message
  return error instanceof Error ? error.message : 'Qualcosa è andato storto.'
}

export const tracksLabel = (count: number) => (count === 1 ? '1 brano' : `${count.toLocaleString('it')} brani`)

/** Secondi → m:ss (o h:mm:ss). */
export function clock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = String(total % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}
