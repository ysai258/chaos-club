/** localStorage wrappers that survive private mode and quota errors. */

export interface Profile {
  name: string
  avatar: string
}

const PROFILE_KEY = 'chaos:profile'
const tokenKey = (code: string) => `chaos:token:${code.toUpperCase()}`

function get(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function set(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    /* ignore */
  }
}

export function loadProfile(): Profile | null {
  const raw = get(PROFILE_KEY)
  if (!raw) return null
  try {
    const p = JSON.parse(raw) as Partial<Profile>
    return typeof p.name === 'string' && typeof p.avatar === 'string' && p.name.trim() ? { name: p.name, avatar: p.avatar } : null
  } catch {
    return null
  }
}

export function saveProfile(p: Profile): void {
  set(PROFILE_KEY, JSON.stringify(p))
}

export function loadToken(code: string): string | null {
  return get(tokenKey(code))
}

export function saveToken(code: string, token: string | null): void {
  set(tokenKey(code), token)
}
