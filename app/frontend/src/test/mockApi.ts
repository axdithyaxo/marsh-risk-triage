import { vi } from 'vitest'

type Reply = [status: number, body?: unknown]
type Route = (body: any, url: URL) => Reply | Promise<Reply>

/** Stub fetch with a route table keyed "METHOD /path". Unknown routes fail
 *  loudly, so a component calling something unexpected can't pass by accident. */
export function mockApi(routes: Record<string, Route>) {
  const fn = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input))
    const key = `${init.method ?? 'GET'} ${url.pathname}`
    const route = routes[key]
    if (!route) throw new Error(`unexpected request: ${key}`)
    const [status, body] = await route(init.body ? JSON.parse(String(init.body)) : undefined, url)
    return new Response(status === 204 ? null : JSON.stringify(body ?? {}), { status })
  })
  vi.stubGlobal('fetch', fn)
  return {
    fn,
    calls: (key: string) =>
      fn.mock.calls
        .filter(([input, init]) => `${init?.method ?? 'GET'} ${new URL(String(input)).pathname}` === key)
        .map(([, init]) => ({ init: init as RequestInit, body: init?.body ? JSON.parse(String(init.body)) : undefined })),
  }
}

export const underwriter = { id: 'u1', email: 'uw@example.com', name: 'Una Writer', role: 'underwriter' as const }
export const auditor = { id: 'a1', email: 'aud@example.com', name: 'Al Auditor', role: 'auditor' as const }

export const branch = (level: string, finding: string) => JSON.stringify({ risk_level: level, confidence: 0.9, finding })
