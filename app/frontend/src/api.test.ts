import { describe, expect, it, vi } from 'vitest'
import { api, ApiError, setUnauthorizedHandler } from './api'
import { mockApi } from './test/mockApi'

describe('api client', () => {
  it('always sends the session cookie, and JSON bodies with a content type', async () => {
    const m = mockApi({ 'POST /api/x': () => [200, { ok: true }] })
    await api.post('/api/x', { a: 1 })
    const init = m.fn.mock.calls[0][1] as RequestInit
    expect(init.credentials).toBe('include')
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json')
    expect(JSON.parse(String(init.body))).toEqual({ a: 1 })
  })

  it('turns a non-OK response into an ApiError carrying the server message', async () => {
    mockApi({ 'POST /api/x': () => [502, { error: 'assessment service unavailable' }] })
    await expect(api.post('/api/x')).rejects.toMatchObject({ status: 502, message: 'assessment service unavailable' })
  })

  it('falls back to a generic message when the error body is not JSON', async () => {
    vi.stubGlobal('fetch', async () => new Response('<html>bad gateway</html>', { status: 502 }))
    await expect(api.get('/api/x')).rejects.toMatchObject({ status: 502, message: 'Request failed (502)' })
  })

  it('reports an unreachable server as status 0, not a raw TypeError', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch')
    })
    const err = await api.get('/api/x').catch((e) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({ status: 0, message: 'Could not reach the server' })
  })

  it('handles 204 No Content', async () => {
    mockApi({ 'POST /api/auth/logout': () => [204] })
    await expect(api.post('/api/auth/logout')).resolves.toBeUndefined()
  })

  it('signals an expired session on a 401, but not for the auth calls themselves', async () => {
    const handler = vi.fn()
    setUnauthorizedHandler(handler)
    mockApi({
      'GET /api/assessments': () => [401, { error: 'authentication required' }],
      'POST /api/auth/login': () => [401, { error: 'invalid email or password' }],
    })
    await api.get('/api/assessments').catch(() => undefined)
    expect(handler).toHaveBeenCalledTimes(1)
    await api.post('/api/auth/login', {}).catch(() => undefined)
    expect(handler).toHaveBeenCalledTimes(1) // a wrong password is not an expired session
    setUnauthorizedHandler(null)
  })
})
