export function decodeOwnershipSecret(value: string | undefined): Uint8Array | null {
  if (!value) return null

  let bytes: Uint8Array
  if (/^[0-9a-f]{64}$/i.test(value)) {
    bytes = new Uint8Array(value.match(/.{2}/g)!.map((pair) => Number.parseInt(pair, 16)))
  } else if (/^[A-Za-z0-9_-]{43}$/.test(value)) {
    try {
      const standardBase64 = value.replaceAll('-', '+').replaceAll('_', '/') + '='
      const decoded = atob(standardBase64)
      bytes = Uint8Array.from(decoded, (character) => character.charCodeAt(0))
      const canonical = btoa(String.fromCharCode(...bytes))
        .replaceAll('+', '-')
        .replaceAll('/', '_')
        .replaceAll('=', '')
      if (canonical !== value) return null
    } catch {
      return null
    }
  } else {
    return null
  }

  if (bytes.length < 32 || hasWeakPattern(bytes)) return null
  return new TextEncoder().encode(value)
}

function decodeJwtSegment(value: string): Record<string, unknown> | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null

  try {
    const base64 = value.replaceAll('-', '+').replaceAll('_', '/')
    const decoded = atob(base64 + '='.repeat((4 - base64.length % 4) % 4))
    const parsed: unknown = JSON.parse(decoded)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

function isServerSideSupabaseKey(value: string) {
  if (/^sb_secret_[A-Za-z0-9_-]{20,}$/.test(value)) return true

  const segments = value.split('.')
  if (segments.length !== 3 || !segments[2]) return false
  const header = decodeJwtSegment(segments[0])
  const payload = decodeJwtSegment(segments[1])
  if (!header || !payload || !/^[A-Za-z0-9_-]+$/.test(segments[2])) return false
  return header.alg === 'HS256' && header.typ === 'JWT' && payload.iss === 'supabase' && payload.role === 'service_role'
}

export function getSupabaseSecretKey(value: string | undefined): string | null {
  if (!value) return null

  try {
    const parsed: unknown = JSON.parse(value)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
    const key = (parsed as Record<string, unknown>).default
    if (typeof key !== 'string' || !key || key !== key.trim() || !isServerSideSupabaseKey(key)) return null
    return key
  } catch {
    return null
  }
}

const visitUuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const visitDeviceTypes = new Set(['mobile', 'desktop', 'tablet', 'unknown'])
const visitRecordFields = new Set([
  'event', 'visit_id', 'visitor_id', 'session_id', 'ownership_token', 'first_visited_at',
  'page_path', 'device_type', 'device_brand', 'device_model', 'operating_system',
  'os_version', 'browser', 'browser_version', 'screen_width', 'screen_height',
  'viewport_width', 'viewport_height', 'device_pixel_ratio', 'language',
])

function isBoundedString(value: unknown, min: number, max: number): value is string {
  return typeof value === 'string' && value.length >= min && value.length <= max
}

function isNullableInteger(value: unknown, max: number): value is number | null {
  return value === null || (Number.isInteger(value) && Number(value) >= 0 && Number(value) <= max)
}

export function toVisitRecord(body: Record<string, unknown>) {
  if (body.event !== 'visit' || !Object.keys(body).every((key) => visitRecordFields.has(key))) return null
  if (!visitUuidPattern.test(String(body.visit_id ?? ''))
    || !visitUuidPattern.test(String(body.visitor_id ?? ''))
    || !visitUuidPattern.test(String(body.session_id ?? ''))) return null
  if (!isBoundedString(body.page_path, 1, 512) || !body.page_path.startsWith('/') || /[?#]/.test(body.page_path)) return null
  if (!visitDeviceTypes.has(String(body.device_type))) return null
  if (!isBoundedString(body.device_brand, 1, 80) || !isBoundedString(body.device_model, 1, 120)) return null
  if (!isBoundedString(body.operating_system, 1, 80) || !isBoundedString(body.os_version, 0, 80)) return null
  if (!isBoundedString(body.browser, 1, 80) || !isBoundedString(body.browser_version, 0, 80)) return null
  if (!isBoundedString(body.language, 1, 40)) return null
  if (!isNullableInteger(body.screen_width, 20000) || !isNullableInteger(body.screen_height, 20000)
    || !isNullableInteger(body.viewport_width, 20000) || !isNullableInteger(body.viewport_height, 20000)) return null
  if (body.device_pixel_ratio !== null
    && (typeof body.device_pixel_ratio !== 'number' || !Number.isFinite(body.device_pixel_ratio)
      || body.device_pixel_ratio < 0 || body.device_pixel_ratio > 20)) return null
  if (body.first_visited_at !== null
    && (typeof body.first_visited_at !== 'string' || body.first_visited_at.length > 40
      || !Number.isFinite(Date.parse(body.first_visited_at)) || Date.parse(body.first_visited_at) > Date.now() + 60_000)) return null

  return {
    visit_id: body.visit_id,
    visitor_id: body.visitor_id,
    session_id: body.session_id,
    first_visited_at: body.first_visited_at,
    page_path: body.page_path,
    device_type: body.device_type,
    device_brand: body.device_brand,
    device_model: body.device_model,
    operating_system: body.operating_system,
    os_version: body.os_version,
    browser: body.browser,
    browser_version: body.browser_version,
    screen_width: body.screen_width,
    screen_height: body.screen_height,
    viewport_width: body.viewport_width,
    viewport_height: body.viewport_height,
    device_pixel_ratio: body.device_pixel_ratio,
    language: body.language,
  }
}

function hasWeakPattern(bytes: Uint8Array) {
  if (new Set(bytes).size < 16) return true
  const printableBytes = bytes.filter((byte) => byte >= 0x20 && byte <= 0x7e).length
  if (printableBytes >= 28) return true

  for (let period = 1; period <= 8; period += 1) {
    let repeats = true
    for (let index = period; index < bytes.length; index += 1) {
      if (bytes[index] !== bytes[index % period]) {
        repeats = false
        break
      }
    }
    if (repeats) return true
  }

  const ascending = bytes.every((byte, index) => index === 0 || byte === ((bytes[index - 1] + 1) & 0xff))
  const descending = bytes.every((byte, index) => index === 0 || byte === ((bytes[index - 1] - 1) & 0xff))
  if (ascending || descending) return true

  const decoded = new TextDecoder().decode(bytes).trim().toLowerCase()
  return /^(?:change(?:me)?|default|example|password|secret|test|your[-_ ]?secret|replace[-_ ]?me)[\s!._-]*$/.test(decoded)
}

function isValidIpv4(value: string) {
  const octets = value.split('.')
  return octets.length === 4 && octets.every((octet) => {
    if (!/^(?:0|[1-9]\d{0,2})$/.test(octet)) return false
    const number = Number(octet)
    return number >= 0 && number <= 255
  })
}

function isValidIpv6(value: string) {
  if (!/^[0-9a-f:.]+$/i.test(value) || value.includes(':::')) return false
  let address = value
  if (address.includes('.')) {
    const finalColon = address.lastIndexOf(':')
    if (finalColon < 0 || !isValidIpv4(address.slice(finalColon + 1))) return false
    const octets = address.slice(finalColon + 1).split('.').map(Number)
    const high = ((octets[0] << 8) | octets[1]).toString(16)
    const low = ((octets[2] << 8) | octets[3]).toString(16)
    address = `${address.slice(0, finalColon)}:${high}:${low}`
  }

  const halves = address.split('::')
  if (halves.length > 2) return false
  const left = halves[0] ? halves[0].split(':') : []
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : []
  const groups = [...left, ...right]
  if (groups.some((group) => !/^[0-9a-f]{1,4}$/i.test(group))) return false
  return halves.length === 2 ? groups.length < 8 : groups.length === 8
}

export function isValidClientIp(value: string) {
  return value.includes(':') ? isValidIpv6(value) : isValidIpv4(value)
}

export function getTrustedClientIp(request: Request) {
  const value = request.headers.get('cf-connecting-ip')?.trim()
  if (!value || value.includes(',') || value.length > 45 || !isValidClientIp(value)) return null
  return value
}

export async function hmacHex(secret: Uint8Array, value: string) {
  const keyMaterial = new ArrayBuffer(secret.byteLength)
  new Uint8Array(keyMaterial).set(secret)
  const key = await crypto.subtle.importKey('raw', keyMaterial, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false
  let difference = 0
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index)
  }
  return difference === 0
}
