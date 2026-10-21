export const BACKEND: string = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:4000'

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

// Called when a request that needed a session comes back 401, i.e. the session
// expired or was ended elsewhere, so the app can drop to the login screen
// instead of showing a confusing error.
let onUnauthorized: (() => void) | null = null
export function setUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn
}

async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${BACKEND}${path}`, {
      method,
      // The session lives in an HttpOnly cookie that scripts can't read; the
      // browser only sends it cross-origin when asked to.
      credentials: 'include',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiError(0, 'Could not reach the server')
  }
  if (res.status === 204) return undefined as T
  // fetch() only rejects on network failure: a 4xx/5xx still resolves, with an
  // error body instead of the shape we typed. Check res.ok before trusting it.
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    const isAuthCall = path.startsWith('/api/auth/')
    if (res.status === 401 && !isAuthCall) onUnauthorized?.()
    throw new ApiError(res.status, data?.error ?? `Request failed (${res.status})`)
  }
  return data as T
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
}
