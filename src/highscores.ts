export type HighscoreRabbit = 'sigge' | 'kurre'

export type HighscoreEntry = {
  id: string
  name: string
  nights: number
  rabbit: HighscoreRabbit
  createdAt: string
}

export type HighscoreSource = 'supabase' | 'local'

type HighscoreResult = {
  entries: HighscoreEntry[]
  source: HighscoreSource
}

type SupabaseRow = {
  id: number | string
  name: string
  nights: number
  rabbit: string
  created_at: string
}

const SUPABASE_URL = 'https://bkkcxhmsfqnmjnrnvqrs.supabase.co'
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_V73RB6c7cv8zWXEXLK0iaQ_SczGpchz'
const HIGHSCORE_TABLE = 'rabbit_highscores'
const LOCAL_STORAGE_KEY = 'rabbit-nights-highscores-v1'
const HIGHSCORE_LIMIT = 10

function isRabbit(value: string): value is HighscoreRabbit {
  return value === 'sigge' || value === 'kurre'
}

function normalizeEntry(value: unknown): HighscoreEntry | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const row = value as Partial<HighscoreEntry & SupabaseRow>
  const createdAt = typeof row.createdAt === 'string' ? row.createdAt : row.created_at
  const nights = Number(row.nights)

  if (
    (typeof row.id !== 'string' && typeof row.id !== 'number')
    || typeof row.name !== 'string'
    || !Number.isInteger(nights)
    || nights < 0
    || typeof row.rabbit !== 'string'
    || !isRabbit(row.rabbit)
    || typeof createdAt !== 'string'
  ) {
    return null
  }

  const name = sanitizeHighscoreName(row.name)
  if (!name) {
    return null
  }

  return {
    id: String(row.id),
    name,
    nights,
    rabbit: row.rabbit,
    createdAt,
  }
}

function sortEntries(entries: HighscoreEntry[]): HighscoreEntry[] {
  return [...entries]
    .sort((a, b) => b.nights - a.nights || a.createdAt.localeCompare(b.createdAt))
    .slice(0, HIGHSCORE_LIMIT)
}

function readLocalHighscores(): HighscoreEntry[] {
  try {
    const stored = localStorage.getItem(LOCAL_STORAGE_KEY)
    if (!stored) {
      return []
    }
    const parsed: unknown = JSON.parse(stored)
    if (!Array.isArray(parsed)) {
      return []
    }
    return sortEntries(parsed.map(normalizeEntry).filter((entry): entry is HighscoreEntry => entry !== null))
  } catch {
    return []
  }
}

function writeLocalHighscores(entries: HighscoreEntry[]): void {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(sortEntries(entries)))
  } catch {
    // Spelet ska fortsätta fungera även om webbläsaren blockerar lokal lagring.
  }
}

function requestHeaders(): HeadersInit {
  return {
    apikey: SUPABASE_PUBLISHABLE_KEY,
    Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
    'Content-Type': 'application/json',
  }
}

function fromSupabaseRow(row: SupabaseRow): HighscoreEntry | null {
  return normalizeEntry(row)
}

export function sanitizeHighscoreName(value: string): string {
  return value.trim().replace(/\s+/g, ' ').slice(0, 20)
}

export async function fetchHighscores(): Promise<HighscoreResult> {
  try {
    const query = new URLSearchParams({
      select: 'id,name,nights,rabbit,created_at',
      order: 'nights.desc,created_at.asc',
      limit: String(HIGHSCORE_LIMIT),
    })
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${HIGHSCORE_TABLE}?${query}`, {
      headers: requestHeaders(),
    })
    if (!response.ok) {
      throw new Error(`Supabase svarade ${response.status}`)
    }

    const rows = await response.json() as SupabaseRow[]
    const entries = rows.map(fromSupabaseRow).filter((entry): entry is HighscoreEntry => entry !== null)
    return { entries: sortEntries(entries), source: 'supabase' }
  } catch {
    return { entries: readLocalHighscores(), source: 'local' }
  }
}

export async function saveHighscore(
  nameInput: string,
  nightsInput: number,
  rabbit: HighscoreRabbit,
): Promise<{ entry: HighscoreEntry; source: HighscoreSource }> {
  const name = sanitizeHighscoreName(nameInput)
  const nights = Math.max(0, Math.min(9999, Math.trunc(nightsInput)))
  if (!name) {
    throw new Error('Skriv in ett namn.')
  }

  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${HIGHSCORE_TABLE}`, {
      method: 'POST',
      headers: {
        ...requestHeaders(),
        Prefer: 'return=representation',
      },
      body: JSON.stringify({ name, nights, rabbit }),
    })
    if (!response.ok) {
      throw new Error(`Supabase svarade ${response.status}`)
    }

    const rows = await response.json() as SupabaseRow[]
    const entry = rows.length > 0 ? fromSupabaseRow(rows[0]) : null
    if (!entry) {
      throw new Error('Supabase returnerade inget resultat.')
    }
    return { entry, source: 'supabase' }
  } catch {
    const entry: HighscoreEntry = {
      id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      nights,
      rabbit,
      createdAt: new Date().toISOString(),
    }
    writeLocalHighscores([...readLocalHighscores(), entry])
    return { entry, source: 'local' }
  }
}
