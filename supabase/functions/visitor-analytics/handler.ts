export interface VisitorVisit {
  visit_id: string
  visitor_id: string
  session_id: string
  page_path: string
  device_type: 'Desktop' | 'Mobile' | 'Tablet' | 'Unknown'
  operating_system: 'Windows 10' | 'Windows 11' | 'Windows' | 'macOS' | 'Linux' | 'Android' | 'iOS' | 'Unknown'
  browser: 'Google Chrome' | 'Microsoft Edge' | 'Mozilla Firefox' | 'Safari' | 'Opera' | 'Other' | 'Unknown'
  browser_version: string | null
  screen_category: 'Mobile' | 'HD' | 'Full HD' | 'QHD' | '4K' | 'Other'
  device_model: string
}

interface ClientHints {
  mobile?: boolean
  platform?: string
  platformVersion?: string
  model?: string
  fullVersionList?: Array<{ brand: string; version: string }>
  brands?: Array<{ brand: string; version: string }>
}

interface Dependencies {
  allowedOrigins: ReadonlySet<string>
  getClientIp(request: Request): string | null
  hashIp(ip: string): Promise<string>
  consumeRateLimit(ipHash: string): Promise<'allowed' | 'limited' | 'capacity'>
  recordConsent(visitorId: string): Promise<void>
  isConsented(visitorId: string): Promise<boolean>
  revokeConsent(visitorId: string): Promise<void>
  insertVisit(visit: VisitorVisit): Promise<void>
}

const maxBodyBytes = 8192
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const screenCategories = new Set(['Mobile', 'HD', 'Full HD', 'QHD', '4K', 'Other'])
const controlCharacters = /[\u0000-\u001F\u007F]/g
const allowedFields = new Set([
  'action',
  'visitor_id',
  'session_id',
  'visit_id',
  'page_path',
  'screen_category',
  'client_hints',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function readBoundedBody(request: Request): Promise<string | null> {
  const reader = request.body?.getReader()
  if (!reader) return null
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      totalBytes += value.byteLength
      if (totalBytes > maxBodyBytes) {
        await reader.cancel()
        return null
      }
      chunks.push(value)
    }
  } catch {
    return null
  }
  const bytes = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return null
  }
}

function jsonResponse(status: number, body: Record<string, boolean | string>, origin: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'access-control-allow-origin': origin,
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info',
      'access-control-max-age': '86400',
      'content-type': 'application/json; charset=utf-8',
      'x-content-type-options': 'nosniff',
      vary: 'Origin',
    },
  })
}

function validUuid(value: unknown): value is string {
  return typeof value === 'string' && uuidPattern.test(value)
}

function parseClientHints(value: unknown): ClientHints | null {
  if (value === undefined) return {}
  if (!isRecord(value) || Object.keys(value).some((key) => ![
    'mobile',
    'platform',
    'platformVersion',
    'model',
    'fullVersionList',
    'brands',
  ].includes(key))) return null

  if (value.mobile !== undefined && typeof value.mobile !== 'boolean') return null
  for (const key of ['platform', 'platformVersion', 'model']) {
    if (value[key] !== undefined && (typeof value[key] !== 'string' || value[key].length > 100)) return null
  }
  for (const key of ['fullVersionList', 'brands']) {
    const list = value[key]
    if (list !== undefined && (!Array.isArray(list) || list.length > 12 || list.some((item) =>
      !isRecord(item)
      || Object.keys(item).some((itemKey) => !['brand', 'version'].includes(itemKey))
      || typeof item.brand !== 'string'
      || item.brand.length > 60
      || typeof item.version !== 'string'
      || item.version.length > 24
    ))) return null
  }
  return value as ClientHints
}

function browserFromBrandList(hints: ClientHints): { name: VisitorVisit['browser']; version: string | null } | null {
  const brands = hints.fullVersionList ?? hints.brands ?? []
  const candidates = [
    { match: /microsoft edge/i, name: 'Microsoft Edge' as const },
    { match: /opera/i, name: 'Opera' as const },
    { match: /google chrome/i, name: 'Google Chrome' as const },
    { match: /firefox/i, name: 'Mozilla Firefox' as const },
    { match: /safari/i, name: 'Safari' as const },
  ]
  for (const candidate of candidates) {
    const brand = brands.find((entry) => candidate.match.test(entry.brand))
    if (brand) {
      const version = /^[0-9]+(?:\.[0-9]+){0,3}$/.test(brand.version) ? brand.version : null
      return { name: candidate.name, version }
    }
  }
  return null
}

function browserFromUserAgent(userAgent: string): { name: VisitorVisit['browser']; version: string | null } {
  const patterns: Array<{ pattern: RegExp; name: VisitorVisit['browser'] }> = [
    { pattern: /(?:Edg|EdgA|EdgiOS)\/([\d.]+)/i, name: 'Microsoft Edge' },
    { pattern: /(?:OPR|Opera)\/([\d.]+)/i, name: 'Opera' },
    { pattern: /(?:Firefox|FxiOS)\/([\d.]+)/i, name: 'Mozilla Firefox' },
    { pattern: /(?:Chrome|CriOS)\/([\d.]+)/i, name: 'Google Chrome' },
    { pattern: /Version\/([\d.]+).*Safari/i, name: 'Safari' },
  ]
  for (const { pattern, name } of patterns) {
    const match = userAgent.match(pattern)
    if (match) {
      const version = match[1]
      return {
        name,
        version: version.length <= 24 && /^[0-9]+(?:\.[0-9]+){0,3}$/.test(version) ? version : null,
      }
    }
  }
  return { name: userAgent ? 'Other' : 'Unknown', version: null }
}

function normalizeOperatingSystem(userAgent: string, hints: ClientHints): VisitorVisit['operating_system'] {
  const platform = hints.platform?.toLowerCase() ?? ''
  if (platform === 'windows') {
    const platformVersion = hints.platformVersion ?? ''
    const versionMajor = /^[0-9]+(?:\.[0-9]+){0,3}$/.test(platformVersion)
      ? Number.parseInt(platformVersion.split('.')[0], 10)
      : Number.NaN
    if (versionMajor === 13) return 'Windows 11'
    if (versionMajor === 10) return 'Windows 10'
    return 'Windows'
  }
  if (platform === 'macos') return 'macOS'
  if (platform === 'android') return 'Android'
  if (platform === 'ios') return 'iOS'
  if (platform === 'linux') return 'Linux'
  if (/Windows NT/i.test(userAgent)) return 'Windows'
  if (/Android/i.test(userAgent)) return 'Android'
  if (/(?:iPhone|iPad|iPod)/i.test(userAgent)) return 'iOS'
  if (/Mac OS X|Macintosh/i.test(userAgent)) return 'macOS'
  if (/Linux/i.test(userAgent)) return 'Linux'
  return 'Unknown'
}

function normalizeDeviceType(userAgent: string, hints: ClientHints): VisitorVisit['device_type'] {
  if (hints.mobile === true) return 'Mobile'
  if (/(?:iPad|Tablet|Kindle|Silk\/)/i.test(userAgent)) return 'Tablet'
  if (/Android/i.test(userAgent) && !/Mobile/i.test(userAgent)) return 'Tablet'
  if (/(?:Mobile|iPhone|iPod|Android.*Mobile)/i.test(userAgent)) return 'Mobile'
  return userAgent ? 'Desktop' : 'Unknown'
}

function normalizeModel(model: unknown): string {
  if (typeof model !== 'string') return 'Unknown'
  const normalized = model.normalize('NFKC').replace(controlCharacters, '').replace(/\s+/g, ' ').trim()
  return normalized && normalized.length <= 100 ? normalized : 'Unknown'
}

export function normalizeDeviceMetadata(
  userAgent: string,
  hints: ClientHints,
  screenCategory: string,
): Pick<VisitorVisit, 'device_type' | 'operating_system' | 'browser' | 'browser_version' | 'screen_category' | 'device_model'> {
  const hintedBrowser = browserFromBrandList(hints)
  const parsedBrowser = hintedBrowser ?? browserFromUserAgent(userAgent)
  return {
    device_type: normalizeDeviceType(userAgent, hints),
    operating_system: normalizeOperatingSystem(userAgent, hints),
    browser: parsedBrowser.name,
    browser_version: parsedBrowser.version,
    screen_category: screenCategories.has(screenCategory)
      ? screenCategory as VisitorVisit['screen_category']
      : 'Other',
    device_model: normalizeModel(hints.model),
  }
}

function parseVisit(body: Record<string, unknown>, userAgent: string): VisitorVisit | null {
  if (
    !validUuid(body.visitor_id)
    || !validUuid(body.session_id)
    || !validUuid(body.visit_id)
    || typeof body.page_path !== 'string'
    || body.page_path.length > 512
    || typeof body.screen_category !== 'string'
    || !screenCategories.has(body.screen_category)
  ) return null

  let pagePath: string
  try {
    const parsed = new URL(body.page_path, 'https://ss-solutions.invalid')
    if (parsed.origin !== 'https://ss-solutions.invalid' || !parsed.pathname.startsWith('/')) return null
    pagePath = parsed.pathname
  } catch {
    return null
  }
  if (pagePath.length > 512) return null

  const hints = parseClientHints(body.client_hints)
  if (!hints) return null

  return {
    visit_id: body.visit_id,
    visitor_id: body.visitor_id,
    session_id: body.session_id,
    page_path: pagePath,
    ...normalizeDeviceMetadata(userAgent, hints, body.screen_category),
  }
}

export function createVisitorAnalyticsHandler(dependencies: Dependencies) {
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
    const bodyText = await readBoundedBody(request)
    if (bodyText === null) return jsonResponse(400, { ok: false, error: 'Invalid request.' }, origin)

    let body: unknown
    try {
      body = JSON.parse(bodyText)
    } catch {
      return jsonResponse(400, { ok: false, error: 'Invalid request.' }, origin)
    }
    if (!isRecord(body) || Object.keys(body).some((key) => !allowedFields.has(key))) {
      return jsonResponse(400, { ok: false, error: 'Invalid request.' }, origin)
    }
    if (!['consent', 'revoke', 'visit'].includes(String(body.action))) {
      return jsonResponse(400, { ok: false, error: 'Invalid action.' }, origin)
    }
    if (!validUuid(body.visitor_id)) return jsonResponse(400, { ok: false, error: 'Invalid visitor ID.' }, origin)
    if (body.action === 'visit' && (Object.keys(body).some((key) => !allowedFields.has(key)))) {
      return jsonResponse(400, { ok: false, error: 'Invalid request.' }, origin)
    }

    const clientIp = dependencies.getClientIp(request)
    if (!clientIp) {
      return jsonResponse(503, { ok: false, error: 'Analytics is temporarily unavailable.' }, origin)
    }

    try {
      const ipHash = await dependencies.hashIp(clientIp)
      const limit = await dependencies.consumeRateLimit(ipHash)
      if (limit === 'limited') return jsonResponse(429, { ok: false, error: 'Analytics limit reached.' }, origin)
      if (limit === 'capacity') return jsonResponse(503, { ok: false, error: 'Analytics is temporarily unavailable.' }, origin)

      if (body.action === 'consent') {
        if (Object.keys(body).some((key) => !['action', 'visitor_id'].includes(key))) {
          return jsonResponse(400, { ok: false, error: 'Invalid consent request.' }, origin)
        }
        await dependencies.recordConsent(body.visitor_id)
        return jsonResponse(200, { ok: true }, origin)
      }
      if (body.action === 'revoke') {
        if (Object.keys(body).some((key) => !['action', 'visitor_id'].includes(key))) {
          return jsonResponse(400, { ok: false, error: 'Invalid revocation request.' }, origin)
        }
        await dependencies.revokeConsent(body.visitor_id)
        return jsonResponse(200, { ok: true }, origin)
      }

      const visit = parseVisit(body, request.headers.get('user-agent') ?? '')
      if (!visit) return jsonResponse(400, { ok: false, error: 'Invalid visit data.' }, origin)
      if (!await dependencies.isConsented(visit.visitor_id)) {
        return jsonResponse(403, { ok: false, error: 'Analytics consent is required.' }, origin)
      }
      await dependencies.insertVisit(visit)
      return jsonResponse(200, { ok: true }, origin)
    } catch {
      console.error('Visitor analytics backend unavailable.')
      return jsonResponse(503, { ok: false, error: 'Analytics is temporarily unavailable.' }, origin)
    }
  }
}
