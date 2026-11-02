export interface ContactSubmission {
  name: string
  email: string
  phone: string | null
  service: string
  message: string
}

interface Dependencies {
  allowedOrigins: ReadonlySet<string>
  getClientIp(request: Request): string | null
  hashIdentifier(kind: 'ip' | 'email', value: string): Promise<string>
  consumeRateLimit(ipHash: string, emailHash: string): Promise<'allowed' | 'limited' | 'capacity'>
  submitInquiry(submission: ContactSubmission): Promise<void>
}

const maxBodyBytes = 16 * 1024
const allowedFields = new Set(['name', 'email', 'phone', 'service', 'message', 'website'])
const emailPattern = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i
const phonePattern = /^[+()0-9 .-]{7,40}$/
const controlCharacters = /[\u0000-\u001F\u007F]/
const messageControlCharacters = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/

function jsonResponse(
  status: number,
  body: Record<string, boolean | string>,
  origin: string,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'access-control-allow-origin': origin,
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info',
      'access-control-max-age': '86400',
      'content-type': 'application/json; charset=utf-8',
      vary: 'Origin',
      'x-content-type-options': 'nosniff',
    },
  })
}

function sanitizeText(value: string, preserveNewlines = false): string {
  const normalized = value.normalize('NFKC').replace(/\r\n?/g, '\n')
  const filtered = [...normalized]
    .filter((character) => {
      const codePoint = character.codePointAt(0)
      return codePoint !== undefined && (
        codePoint === 0x09
        || codePoint === 0x0a
        || codePoint === 0x20
        || (codePoint > 0x1f && (codePoint < 0x7f || codePoint > 0x9f))
      )
    })
    .join('')

  return preserveNewlines
    ? filtered.split('\n').map((line) => line.replace(/[ \t]+/g, ' ').trim()).join('\n').trim()
    : filtered.replace(/\s+/g, ' ').trim()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function readBoundedBody(request: Request): Promise<
  { kind: 'ok'; body: string } | { kind: 'invalid' } | { kind: 'too-large' }
> {
  const reader = request.body?.getReader()
  if (!reader) return { kind: 'invalid' }

  const chunks: Uint8Array[] = []
  let totalBytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      totalBytes += value.byteLength
      if (totalBytes > maxBodyBytes) {
        await reader.cancel()
        return { kind: 'too-large' }
      }
      chunks.push(value)
    }
  } catch {
    return { kind: 'invalid' }
  }

  const bytes = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return { kind: 'ok', body: new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
  } catch {
    return { kind: 'invalid' }
  }
}

function parseSubmission(value: unknown): ContactSubmission | 'honeypot' | null {
  if (!isRecord(value) || Object.keys(value).some((key) => !allowedFields.has(key))) return null
  if (value.website !== undefined && typeof value.website !== 'string') return null
  if (typeof value.website === 'string' && value.website.trim()) return 'honeypot'

  const { name, email, phone, service, message } = value
  if (
    typeof name !== 'string'
    || typeof email !== 'string'
    || (phone !== null && phone !== undefined && typeof phone !== 'string')
    || typeof service !== 'string'
    || typeof message !== 'string'
  ) return null
  if ([name, email, service].some((field) => controlCharacters.test(field))) return null
  if (messageControlCharacters.test(message)) return null
  if (typeof phone === 'string' && controlCharacters.test(phone)) return null

  const cleanName = sanitizeText(name)
  const cleanEmail = sanitizeText(email).toLowerCase()
  const cleanService = sanitizeText(service)
  const cleanMessage = sanitizeText(message, true)
  const cleanPhone = typeof phone === 'string' ? sanitizeText(phone) : ''

  if (
    cleanName.length < 2 || cleanName.length > 120
    || cleanEmail.length < 5 || cleanEmail.length > 254 || !emailPattern.test(cleanEmail)
    || cleanService.length < 2 || cleanService.length > 100
    || cleanMessage.length < 15 || cleanMessage.length > 4000
    || (cleanPhone !== '' && !phonePattern.test(cleanPhone))
  ) return null

  return {
    name: cleanName,
    email: cleanEmail,
    phone: cleanPhone || null,
    service: cleanService,
    message: cleanMessage,
  }
}

export function createContactSubmitHandler(dependencies: Dependencies) {
  return async (request: Request): Promise<Response> => {
    const origin = request.headers.get('origin')
    if (!origin || !dependencies.allowedOrigins.has(origin)) {
      return new Response(null, { status: 403, headers: { vary: 'Origin' } })
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'access-control-allow-origin': origin,
          'access-control-allow-methods': 'POST, OPTIONS',
          'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info',
          'access-control-max-age': '86400',
          vary: 'Origin',
        },
      })
    }
    if (request.method !== 'POST') return jsonResponse(405, { ok: false, error: 'Method not allowed.' }, origin)

    const contentType = request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase()
    if (contentType !== 'application/json') {
      return jsonResponse(415, { ok: false, error: 'Unsupported content type.' }, origin)
    }

    const contentLengthHeader = request.headers.get('content-length')
    const contentLength = contentLengthHeader === null ? 0 : Number(contentLengthHeader)
    if (!Number.isSafeInteger(contentLength) || contentLength < 0) {
      return jsonResponse(400, { ok: false, error: 'Invalid request.' }, origin)
    }
    if (contentLength > maxBodyBytes) {
      return jsonResponse(413, { ok: false, error: 'Request is too large.' }, origin)
    }
    const bodyResult = await readBoundedBody(request)
    if (bodyResult.kind === 'too-large') return jsonResponse(413, { ok: false, error: 'Request is too large.' }, origin)
    if (bodyResult.kind === 'invalid') return jsonResponse(400, { ok: false, error: 'Invalid request.' }, origin)

    let body: unknown
    try {
      body = JSON.parse(bodyResult.body)
    } catch {
      return jsonResponse(400, { ok: false, error: 'Invalid request.' }, origin)
    }

    const submission = parseSubmission(body)
    if (submission === 'honeypot') return jsonResponse(200, { ok: true }, origin)
    if (!submission) return jsonResponse(400, { ok: false, error: 'Invalid submission.' }, origin)

    const clientIp = dependencies.getClientIp(request)
    if (!clientIp) {
      return jsonResponse(503, { ok: false, error: 'Submission is temporarily unavailable.' }, origin)
    }

    try {
      const [ipHash, emailHash] = await Promise.all([
        dependencies.hashIdentifier('ip', clientIp),
        dependencies.hashIdentifier('email', submission.email),
      ])
      const rateLimitResult = await dependencies.consumeRateLimit(ipHash, emailHash)
      if (rateLimitResult === 'limited') {
        return jsonResponse(429, { ok: false, error: 'Too many submissions. Please try again later.' }, origin)
      }
      if (rateLimitResult === 'capacity') {
        return jsonResponse(503, { ok: false, error: 'Submission is temporarily unavailable.' }, origin)
      }

      await dependencies.submitInquiry(submission)
      return jsonResponse(200, { ok: true }, origin)
    } catch {
      console.error('Contact submission backend unavailable.')
      return jsonResponse(503, { ok: false, error: 'Submission is temporarily unavailable.' }, origin)
    }
  }
}

export function parseTrustedIp(value: string | null): string | null {
  if (!value || value !== value.trim() || value.includes(',') || value.includes('%')) return null

  if (/^[0-9.]+$/.test(value)) {
    const octets = value.split('.')
    if (octets.length !== 4 || octets.some((octet) => !/^(0|[1-9]\d{0,2})$/.test(octet) || Number(octet) > 255)) {
      return null
    }
    return octets.join('.')
  }

  if (!/^[\da-fA-F:.]+$/.test(value) || !value.includes(':')) return null
  try {
    const hostname = new URL(`http://[${value}]/`).hostname
    const normalized = hostname.slice(1, -1).toLowerCase()
    return normalized ? normalized : null
  } catch {
    return null
  }
}

export function getTrustedClientIp(
  request: Request,
  trustedHeader: string,
  ingressVerified: boolean,
): string | null {
  if (!ingressVerified || trustedHeader !== 'cf-connecting-ip') return null
  return parseTrustedIp(request.headers.get(trustedHeader))
}
