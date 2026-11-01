import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  constantTimeEqual,
  decodeOwnershipSecret,
  getSupabaseSecretKey,
  getTrustedClientIp,
  hmacHex,
  toVisitRecord,
} from './security.ts'

const allowedProductionOrigin = 'https://gitco200-cyber.github.io'
const allowedLocalOrigin = /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d{1,5})?$/
const maxBodyBytes = 8192
const maxRequestsPerHour = 100
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
function isAllowedOrigin(origin: string) {
  return origin === allowedProductionOrigin || allowedLocalOrigin.test(origin)
}

function responseHeaders(origin: string | null) {
  const headers = new Headers({
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
    'Vary': 'Origin',
  })
  if (origin && isAllowedOrigin(origin)) headers.set('Access-Control-Allow-Origin', origin)
  return headers
}

function respond(request: Request, status: number, body: Record<string, string>) {
  return new Response(JSON.stringify(body), { status, headers: responseHeaders(request.headers.get('origin')) })
}

function hasOnlyKeys(body: Record<string, unknown>, allowed: Set<string>) {
  return Object.keys(body).every((key) => allowed.has(key))
}

async function readJson(request: Request): Promise<{ body: Record<string, unknown>; error?: never } | { body?: never; error: string }> {
  const contentType = request.headers.get('content-type')?.toLowerCase() ?? ''
  if (!contentType.includes('application/json')) return { error: 'JSON payload required.' }
  const contentLength = Number(request.headers.get('content-length') ?? 0)
  if (contentLength > maxBodyBytes) return { error: 'Payload too large.' }
  if (!request.body) return { error: 'Request body is required.' }

  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      totalBytes += value.byteLength
      if (totalBytes > maxBodyBytes) {
        await reader.cancel()
        return { error: 'Payload too large.' }
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { error: 'Invalid payload.' }
    return { body: parsed as Record<string, unknown> }
  } catch {
    return { error: 'Invalid JSON payload.' }
  }
}

Deno.serve(async (request) => {
  const origin = request.headers.get('origin')
  if (origin && !isAllowedOrigin(origin)) return respond(request, 403, { error: 'Origin not allowed.' })
  if (request.method === 'OPTIONS') {
    if (!origin) return new Response(null, { status: 403 })
    return new Response(null, { status: 204, headers: responseHeaders(origin) })
  }
  if (request.method !== 'POST') return respond(request, 405, { error: 'Method not allowed.' })

  const clientIp = getTrustedClientIp(request)
  if (!clientIp) return respond(request, 503, { error: 'Analytics service cannot verify the request source.' })

  const parsed = await readJson(request)
  if (!parsed.body) return respond(request, 400, { error: parsed.error ?? 'Invalid request.' })
  const body = parsed.body
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const supabaseSecretKey = getSupabaseSecretKey(Deno.env.get('SUPABASE_SECRET_KEYS'))
  const ownershipSecret = decodeOwnershipSecret(Deno.env.get('VISITOR_ANALYTICS_OWNERSHIP_SECRET'))
  if (!supabaseUrl || !supabaseSecretKey || !ownershipSecret) {
    return respond(request, 503, { error: 'Analytics service is not configured.' })
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseSecretKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const rateHash = await hmacHex(ownershipSecret, `rate-limit:${clientIp}`)
    const { data: permitted, error: limitError } = await supabase.rpc('consume_visitor_analytics_rate_limit', {
      p_client_hash: rateHash,
      p_limit: maxRequestsPerHour,
    })
    if (limitError) {
      console.error('Visitor analytics rate limit check failed.')
      return respond(request, 503, { error: 'Analytics service is temporarily unavailable.' })
    }
    if (!permitted) return respond(request, 429, { error: 'Analytics request limit reached. Try again later.' })

    if (body.event === 'initialize') {
      if (!hasOnlyKeys(body, new Set(['event']))) return respond(request, 400, { error: 'Invalid initialization request.' })
      const visitorId = crypto.randomUUID()
      const ownershipToken = await hmacHex(ownershipSecret, `visitor-owner:${visitorId}`)
      return new Response(JSON.stringify({ visitor_id: visitorId, ownership_token: ownershipToken }), {
        status: 200,
        headers: responseHeaders(origin),
      })
    }

    if (body.event !== 'visit') return respond(request, 400, { error: 'Unsupported analytics event.' })
    const visitorId = body.visitor_id
    const ownershipToken = body.ownership_token
    if (typeof visitorId !== 'string' || !uuidPattern.test(visitorId)
      || typeof ownershipToken !== 'string' || !/^[0-9a-f]{64}$/.test(ownershipToken)) {
      return respond(request, 401, { error: 'Visitor ownership could not be verified.' })
    }
    const expectedToken = await hmacHex(ownershipSecret, `visitor-owner:${visitorId}`)
    if (!constantTimeEqual(ownershipToken, expectedToken)) {
      return respond(request, 401, { error: 'Visitor ownership could not be verified.' })
    }

    const record = toVisitRecord(body)
    if (!record || record.visitor_id !== visitorId) return respond(request, 400, { error: 'Visit data did not pass validation.' })
    const { error } = await supabase.from('visitor_analytics').insert(record)
    if (error) {
      console.error('Visitor analytics insert failed.')
      return respond(request, 503, { error: 'Analytics event could not be saved.' })
    }
    return new Response(null, { status: 204, headers: responseHeaders(origin) })
  } catch {
    console.error('Visitor analytics request failed.')
    return respond(request, 503, { error: 'Analytics service is temporarily unavailable.' })
  }
})
