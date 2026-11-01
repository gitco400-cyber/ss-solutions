import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { constantTimeEqual, decodeOwnershipSecret, getTrustedClientIp, hmacHex } from './security.ts'

const allowedProductionOrigin = 'https://gitco200-cyber.github.io'
const allowedLocalOrigin = /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d{1,5})?$/
const maxBodyBytes = 8192
const maxRequestsPerHour = 100
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const allowedDeviceTypes = new Set(['mobile', 'desktop', 'tablet', 'unknown'])
const allowedGpsStatuses = new Set(['not_requested', 'denied', 'unavailable', 'error'])
const allowedConsentStatuses = new Set(['not_asked', 'declined', 'consented', 'revoked'])
const recordFields = new Set([
  'visit_id', 'visitor_id', 'session_id', 'first_visited_at', 'page_path', 'referrer',
  'device_type', 'device_brand', 'device_model', 'operating_system', 'os_version',
  'browser', 'browser_version', 'screen_width', 'screen_height', 'device_pixel_ratio',
  'language', 'timezone', 'location_consent_status', 'location_consent_version', 'gps_permission_status',
  'latitude', 'longitude', 'gps_accuracy', 'gps_collected_at',
])

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

function isBoundedString(value: unknown, min: number, max: number): value is string {
  return typeof value === 'string' && value.length >= min && value.length <= max
}

function isNullableInteger(value: unknown, max: number): value is number | null {
  return value === null || (Number.isInteger(value) && Number(value) >= 0 && Number(value) <= max)
}

function hasOnlyKeys(body: Record<string, unknown>, allowed: Set<string>) {
  return Object.keys(body).every((key) => allowed.has(key))
}

function normalizeReferrer(value: unknown) {
  if (value === null) return null
  if (typeof value !== 'string' || value.length > 2048) return undefined
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined
    return `${url.origin}${url.pathname}`.slice(0, 512)
  } catch {
    return undefined
  }
}

function isValidFirstVisit(value: unknown): value is string | null {
  if (value === null) return true
  if (typeof value !== 'string' || value.length > 40) return false
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) && timestamp <= Date.now() + 60_000
}

function toVisitRecord(body: Record<string, unknown>) {
  if (!hasOnlyKeys(body, new Set([...recordFields, 'event', 'ownership_token']))) return null
  if (!uuidPattern.test(String(body.visit_id ?? ''))
    || !uuidPattern.test(String(body.visitor_id ?? ''))
    || !uuidPattern.test(String(body.session_id ?? ''))
    || !uuidPattern.test(String(body.location_consent_version ?? ''))) return null
  if (!isBoundedString(body.page_path, 1, 512) || !body.page_path.startsWith('/') || /[?#]/.test(body.page_path)) return null
  if (!allowedDeviceTypes.has(String(body.device_type))) return null
  if (!isBoundedString(body.device_brand, 1, 80) || !isBoundedString(body.device_model, 1, 120)) return null
  if (!isBoundedString(body.operating_system, 1, 80) || !isBoundedString(body.os_version, 0, 80)) return null
  if (!isBoundedString(body.browser, 1, 80) || !isBoundedString(body.browser_version, 0, 80)) return null
  if (!isBoundedString(body.language, 1, 40) || !isBoundedString(body.timezone, 1, 100)) return null
  if (!isNullableInteger(body.screen_width, 20000) || !isNullableInteger(body.screen_height, 20000)) return null
  if (body.device_pixel_ratio !== null
    && (typeof body.device_pixel_ratio !== 'number' || !Number.isFinite(body.device_pixel_ratio)
      || body.device_pixel_ratio < 0 || body.device_pixel_ratio > 20)) return null
  if (!isValidFirstVisit(body.first_visited_at)) return null

  const referrer = normalizeReferrer(body.referrer)
  if (referrer === undefined) return null
  const consentStatus = String(body.location_consent_status ?? 'not_asked')
  const gpsStatus = String(body.gps_permission_status ?? 'not_requested')
  if (!allowedConsentStatuses.has(consentStatus) || gpsStatus !== 'not_requested') return null
  if (['latitude', 'longitude', 'gps_accuracy', 'gps_collected_at'].some((key) => body[key] !== undefined && body[key] !== null)) return null

  return {
    visit_id: body.visit_id,
    visitor_id: body.visitor_id,
    session_id: body.session_id,
    first_visited_at: body.first_visited_at,
    page_path: body.page_path,
    referrer,
    device_type: body.device_type,
    device_brand: body.device_brand,
    device_model: body.device_model,
    operating_system: body.operating_system,
    os_version: body.os_version,
    browser: body.browser,
    browser_version: body.browser_version,
    screen_width: body.screen_width,
    screen_height: body.screen_height,
    device_pixel_ratio: body.device_pixel_ratio,
    language: body.language,
    timezone: body.timezone,
    location_consent_status: consentStatus,
    location_consent_version: body.location_consent_version,
    gps_permission_status: 'not_requested',
    latitude: null,
    longitude: null,
    gps_accuracy: null,
    gps_collected_at: null,
  }
}

function randomToken(byteLength = 32) {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength))
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
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
  const rawBody = new TextDecoder().decode(bytes)
  try {
    const parsed: unknown = JSON.parse(rawBody)
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
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const ownershipSecret = decodeOwnershipSecret(Deno.env.get('VISITOR_ANALYTICS_OWNERSHIP_SECRET'))
  if (!supabaseUrl || !serviceRoleKey || !ownershipSecret) {
    return respond(request, 503, { error: 'Analytics service is not configured.' })
  }

  try {
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
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

    const visitorId = body.visitor_id
    const visitId = body.visit_id
    const ownershipToken = body.ownership_token
    if (typeof visitorId !== 'string' || !uuidPattern.test(visitorId)
      || typeof ownershipToken !== 'string' || !/^[0-9a-f]{64}$/.test(ownershipToken)) {
      return respond(request, 401, { error: 'Visitor ownership could not be verified.' })
    }
    const expectedToken = await hmacHex(ownershipSecret, `visitor-owner:${visitorId}`)
    if (!constantTimeEqual(ownershipToken, expectedToken)) {
      return respond(request, 401, { error: 'Visitor ownership could not be verified.' })
    }

    if (body.event === 'visit') {
      const record = toVisitRecord(body)
      if (!record || record.visitor_id !== visitorId) return respond(request, 400, { error: 'Visit data did not pass validation.' })
      const { error } = await supabase.from('visitor_analytics').insert(record)
      if (error) {
        console.error('Visitor analytics insert failed.')
        return respond(request, 503, { error: 'Analytics event could not be saved.' })
      }
      return new Response(null, { status: 204, headers: responseHeaders(origin) })
    }

    if (typeof visitId !== 'string' || !uuidPattern.test(visitId)) {
      return respond(request, 400, { error: 'Visit identifier is invalid.' })
    }
    const consentVersion = body.location_consent_version
    if (typeof consentVersion !== 'string' || !uuidPattern.test(consentVersion)) {
      return respond(request, 400, { error: 'Location consent version is invalid.' })
    }

    if (body.event === 'gps_reconsent') {
      if (!hasOnlyKeys(body, new Set([
        'event', 'visitor_id', 'visit_id', 'ownership_token', 'location_consent_version',
      ]))) return respond(request, 400, { error: 'Invalid location re-consent request.' })

      const nextConsentVersion = crypto.randomUUID()
      const { data: updatedVisit, error } = await supabase.from('visitor_analytics').update({
        location_consent_status: 'consented',
        location_consent_version: nextConsentVersion,
        gps_permission_status: 'not_requested',
      }).eq('visitor_id', visitorId)
        .eq('visit_id', visitId)
        .eq('location_consent_version', consentVersion)
        .eq('location_consent_status', 'revoked')
        .is('latitude', null)
        .is('longitude', null)
        .is('gps_accuracy', null)
        .is('gps_collected_at', null)
        .select('visit_id')
        .maybeSingle()
      if (error) {
        console.error('Visitor GPS re-consent update failed.')
        return respond(request, 503, { error: 'Location sharing could not be re-authorized.' })
      }
      if (!updatedVisit) return respond(request, 409, { error: 'This visit has changed; reload before sharing location again.' })
      return new Response(JSON.stringify({ location_consent_version: nextConsentVersion }), {
        status: 200,
        headers: responseHeaders(origin),
      })
    }

    if (body.event === 'location_challenge') {
      if (!hasOnlyKeys(body, new Set([
        'event', 'visitor_id', 'visit_id', 'ownership_token', 'location_consent_version',
      ]))) {
        return respond(request, 400, { error: 'Invalid location authorization request.' })
      }
      const { data: visit, error: visitError } = await supabase.from('visitor_analytics')
        .select('visit_id, location_consent_status, location_consent_version, gps_permission_status, latitude, longitude, gps_accuracy, gps_collected_at')
        .eq('visitor_id', visitorId)
        .eq('visit_id', visitId)
        .eq('location_consent_version', consentVersion)
        .maybeSingle()
      if (visitError || !visit) return respond(request, 404, { error: 'Visit record was not found.' })
      if (visit.location_consent_status !== 'consented'
        || visit.gps_permission_status === 'revoked'
        || visit.latitude !== null
        || visit.longitude !== null
        || visit.gps_accuracy !== null
        || visit.gps_collected_at !== null) {
        return respond(request, 403, { error: 'Location consent is required before sharing GPS.' })
      }

      const challengeToken = randomToken()
      const challengeHash = await hmacHex(ownershipSecret, `gps-challenge:${challengeToken}`)
      const { error } = await supabase.from('visitor_analytics_gps_challenges').insert({
        challenge_hash: challengeHash,
        visitor_id: visitorId,
        visit_id: visitId,
        consent_version: consentVersion,
        expires_at: new Date(Date.now() + 5 * 60_000).toISOString(),
      })
      if (error) {
        console.error('Visitor GPS challenge could not be created.')
        return respond(request, 503, { error: 'Location sharing could not be authorized.' })
      }
      return new Response(JSON.stringify({ challenge_token: challengeToken }), {
        status: 200,
        headers: responseHeaders(origin),
      })
    }

    if (body.event === 'gps_status') {
      if (!hasOnlyKeys(body, new Set([
        'event', 'visitor_id', 'visit_id', 'ownership_token', 'location_consent_version',
        'gps_permission_status', 'location_consent_status',
      ]))) return respond(request, 400, { error: 'Invalid location status request.' })
      const status = String(body.gps_permission_status ?? '')
      const consent = String(body.location_consent_status ?? '')
      if (!allowedGpsStatuses.has(status) || !allowedConsentStatuses.has(consent) || consent === 'revoked') {
        return respond(request, 400, { error: 'Location status did not pass validation.' })
      }
      const { data: updatedVisit, error } = await supabase.from('visitor_analytics').update({
        gps_permission_status: status,
        location_consent_status: consent,
      }).eq('visitor_id', visitorId)
        .eq('visit_id', visitId)
        .eq('location_consent_version', consentVersion)
        .neq('gps_permission_status', 'revoked')
        .is('latitude', null)
        .is('longitude', null)
        .is('gps_accuracy', null)
        .is('gps_collected_at', null)
        .select('visit_id')
        .maybeSingle()
      if (error) {
        console.error('Visitor GPS status update failed.')
        return respond(request, 503, { error: 'Location status could not be saved.' })
      }
      if (!updatedVisit) return respond(request, 409, { error: 'This visit has changed; reload before updating location status.' })
      return new Response(null, { status: 204, headers: responseHeaders(origin) })
    }

    if (body.event === 'gps_grant') {
      if (!hasOnlyKeys(body, new Set([
        'event', 'visitor_id', 'visit_id', 'ownership_token', 'challenge_token',
        'location_consent_version', 'latitude', 'longitude', 'gps_accuracy', 'gps_collected_at',
      ]))) return respond(request, 400, { error: 'Invalid GPS update.' })
      if (typeof body.challenge_token !== 'string' || !/^[A-Za-z0-9_-]{40,50}$/.test(body.challenge_token)) {
        return respond(request, 400, { error: 'Location authorization is invalid or expired.' })
      }
      const { latitude, longitude, gps_accuracy: accuracy, gps_collected_at: collectedAt } = body
      if (typeof latitude !== 'number' || !Number.isFinite(latitude) || latitude < -90 || latitude > 90) return respond(request, 400, { error: 'GPS latitude is invalid.' })
      if (typeof longitude !== 'number' || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) return respond(request, 400, { error: 'GPS longitude is invalid.' })
      if (typeof accuracy !== 'number' || !Number.isFinite(accuracy) || accuracy < 0 || accuracy > 100000) return respond(request, 400, { error: 'GPS accuracy is invalid.' })
      if (typeof collectedAt !== 'string' || !Number.isFinite(Date.parse(collectedAt)) || Date.parse(collectedAt) > Date.now() + 60_000) {
        return respond(request, 400, { error: 'GPS timestamp is invalid.' })
      }

      const challengeHash = await hmacHex(ownershipSecret, `gps-challenge:${body.challenge_token}`)
      const { data: authorized, error: challengeError } = await supabase.rpc('consume_visitor_analytics_gps_challenge', {
        p_challenge_hash: challengeHash,
        p_visitor_id: visitorId,
        p_visit_id: visitId,
      })
      if (challengeError || !authorized) return respond(request, 401, { error: 'Location authorization is invalid or expired.' })

      const { data: updatedVisit, error } = await supabase.from('visitor_analytics').update({
        gps_permission_status: 'granted',
        location_consent_status: 'consented',
        latitude,
        longitude,
        gps_accuracy: accuracy,
        gps_collected_at: collectedAt,
      }).eq('visitor_id', visitorId).eq('visit_id', visitId)
      .eq('location_consent_version', consentVersion)
      .eq('location_consent_status', 'consented')
      .neq('gps_permission_status', 'revoked')
      .is('latitude', null)
      .is('longitude', null)
      .is('gps_accuracy', null)
      .is('gps_collected_at', null)
        .select('visit_id')
        .maybeSingle()
      if (error) {
        console.error('Visitor GPS update failed.')
        return respond(request, 503, { error: 'GPS data could not be saved.' })
      }
      if (!updatedVisit) return respond(request, 403, { error: 'Location consent is required before sharing GPS.' })
      return new Response(null, { status: 204, headers: responseHeaders(origin) })
    }

    if (body.event === 'revoke') {
      if (!hasOnlyKeys(body, new Set([
        'event', 'visitor_id', 'visit_id', 'ownership_token', 'location_consent_version',
      ]))) {
        return respond(request, 400, { error: 'Invalid revocation request.' })
      }
      const { error: deleteError } = await supabase.from('visitor_analytics_gps_challenges')
        .delete()
        .eq('visitor_id', visitorId)
      if (deleteError) {
        console.error('Visitor GPS challenges could not be invalidated.')
        return respond(request, 503, { error: 'Saved GPS data could not be cleared.' })
      }
      const nextConsentVersion = crypto.randomUUID()
      const { data: revokedVisits, error } = await supabase.from('visitor_analytics').update({
        location_consent_status: 'revoked',
        location_consent_version: nextConsentVersion,
        gps_permission_status: 'revoked',
        latitude: null,
        longitude: null,
        gps_accuracy: null,
        gps_collected_at: null,
      }).eq('visitor_id', visitorId)
        .select('visit_id')
      if (error) {
        console.error('Visitor GPS revocation failed.')
        return respond(request, 503, { error: 'Saved GPS data could not be cleared.' })
      }
      if (!revokedVisits?.length) return respond(request, 404, { error: 'Visitor record was not found.' })
      return new Response(JSON.stringify({ location_consent_version: nextConsentVersion }), {
        status: 200,
        headers: responseHeaders(origin),
      })
    }

    return respond(request, 400, { error: 'Unsupported analytics event.' })
  } catch {
    console.error('Visitor analytics request failed.')
    return respond(request, 503, { error: 'Analytics service is temporarily unavailable.' })
  }
})
