import {
  createVisitorAnalyticsHandler,
  normalizeDeviceMetadata,
  type VisitorVisit,
} from './handler.ts'

const origin = 'https://gitco200-cyber.github.io'
const visitorId = '00000000-0000-4000-8000-000000000001'
const sessionId = '00000000-0000-4000-8000-000000000002'
const visitId = '00000000-0000-4000-8000-000000000003'

function createDependencies(overrides: Partial<Parameters<typeof createVisitorAnalyticsHandler>[0]> = {}) {
  const visits: VisitorVisit[] = []
  const consents = new Set<string>()
  const dependencies = {
    allowedOrigins: new Set([origin]),
    getClientIp: () => '192.0.2.10',
    hashIp: async () => 'a'.repeat(64),
    consumeRateLimit: async () => 'allowed' as const,
    recordConsent: async (id: string) => { consents.add(id) },
    isConsented: async (id: string) => consents.has(id),
    revokeConsent: async (id: string) => {
      consents.delete(id)
      for (let index = visits.length - 1; index >= 0; index -= 1) {
        if (visits[index].visitor_id === id) visits.splice(index, 1)
      }
    },
    insertVisit: async (visit: VisitorVisit) => { visits.push(visit) },
    ...overrides,
  }
  return { dependencies, visits, consents }
}

function request(body: unknown, headers: HeadersInit = {}): Request {
  return new Request('https://functions.test/visitor-analytics', {
    method: 'POST',
    headers: {
      origin,
      'content-type': 'application/json',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/123.0.0.0 Safari/537.36',
      ...headers,
    },
    body: JSON.stringify(body),
  })
}

Deno.test('consent is required and a valid visit is normalized without raw identifiers', async () => {
  const { dependencies, visits } = createDependencies()
  const handler = createVisitorAnalyticsHandler(dependencies)
  const consent = await handler(request({ action: 'consent', visitor_id: visitorId }))
  if (consent.status !== 200) throw new Error('Expected consent registration to succeed.')

  const response = await handler(request({
    action: 'visit',
    visitor_id: visitorId,
    session_id: sessionId,
    visit_id: visitId,
    page_path: '/services?utm_source=ignored',
    screen_category: 'Full HD',
    client_hints: { mobile: false, platform: 'Windows', platformVersion: '13.0.0', model: '' },
  }))
  if (response.status !== 200 || visits.length !== 1) throw new Error('Expected one consented visit.')
  const visit = visits[0]
  if (visit.page_path !== '/services') throw new Error('Query parameters must not be stored.')
  if (visit.device_type !== 'Desktop' || visit.operating_system !== 'Windows 11') throw new Error('Device details were not normalized.')
  if (visit.browser !== 'Google Chrome' || visit.browser_version !== '123.0.0.0') throw new Error('Browser details were not normalized.')
  if (visit.device_model !== 'Unknown' || visit.screen_category !== 'Full HD') throw new Error('Unknown or coarse data was not normalized.')
  if (Object.keys(visit).some((key) => /ip|user.agent|screen.width|screen.height/i.test(key))) {
    throw new Error('Raw IP, user-agent, or precise screen fields must not be stored.')
  }
})

Deno.test('visits without consent and malformed visit input are rejected', async () => {
  const { dependencies } = createDependencies()
  const handler = createVisitorAnalyticsHandler(dependencies)
  const noConsent = await handler(request({
    action: 'visit',
    visitor_id: visitorId,
    session_id: sessionId,
    visit_id: visitId,
    page_path: '/',
    screen_category: 'Mobile',
  }))
  if (noConsent.status !== 403) throw new Error('A visit without consent must be rejected.')

  const malformed = await handler(request({
    action: 'visit',
    visitor_id: visitorId,
    session_id: 'not-a-uuid',
    visit_id: visitId,
    page_path: '/',
    screen_category: '1920x1080',
  }))
  if (malformed.status !== 400) throw new Error('Malformed identifiers and detailed resolutions must be rejected.')
})

Deno.test('trusted ingress is required and the handler never falls back to caller headers', async () => {
  let rateLimitCalls = 0
  const { dependencies } = createDependencies({
    getClientIp: () => null,
    consumeRateLimit: async () => {
      rateLimitCalls += 1
      return 'allowed'
    },
  })
  const handler = createVisitorAnalyticsHandler(dependencies)
  const response = await handler(request({ action: 'consent', visitor_id: visitorId }, {
    'cf-connecting-ip': '198.51.100.10',
    'x-forwarded-for': '203.0.113.20',
  }))
  if (response.status !== 503 || rateLimitCalls !== 0) {
    throw new Error('Unverified request headers must not enable analytics or rate limiting.')
  }
})

Deno.test('rate limits and backend errors fail closed', async () => {
  const limitedDependencies = createDependencies({
    consumeRateLimit: async () => 'limited',
  })
  const limitedResponse = await createVisitorAnalyticsHandler(limitedDependencies.dependencies)(
    request({ action: 'consent', visitor_id: visitorId }),
  )
  if (limitedResponse.status !== 429) throw new Error('Limited requests must be rejected.')

  const failedDependencies = createDependencies({
    hashIp: async () => { throw new Error('HMAC unavailable') },
  })
  const failedResponse = await createVisitorAnalyticsHandler(failedDependencies.dependencies)(
    request({ action: 'consent', visitor_id: visitorId }),
  )
  if (failedResponse.status !== 503) throw new Error('HMAC failures must fail closed.')

  const unavailableStorage = createDependencies({
    consumeRateLimit: async () => { throw new Error('Rate-limit storage unavailable') },
  })
  const storageResponse = await createVisitorAnalyticsHandler(unavailableStorage.dependencies)(
    request({ action: 'consent', visitor_id: visitorId }),
  )
  if (storageResponse.status !== 503) throw new Error('Rate-limit storage failures must fail closed.')
})

Deno.test('revocation removes existing visits and prevents future collection', async () => {
  const { dependencies, visits } = createDependencies()
  const handler = createVisitorAnalyticsHandler(dependencies)
  await handler(request({ action: 'consent', visitor_id: visitorId }))
  await handler(request({
    action: 'visit',
    visitor_id: visitorId,
    session_id: sessionId,
    visit_id: visitId,
    page_path: '/',
    screen_category: 'HD',
  }))
  const revokeResponse = await handler(request({ action: 'revoke', visitor_id: visitorId }))
  if (revokeResponse.status !== 200 || visits.length !== 0) throw new Error('Revocation must remove stored visits.')

  const laterVisit = await handler(request({
    action: 'visit',
    visitor_id: visitorId,
    session_id: sessionId,
    visit_id: '00000000-0000-4000-8000-000000000004',
    page_path: '/',
    screen_category: 'HD',
  }))
  if (laterVisit.status !== 403) throw new Error('Revoked consent must prevent new visits.')
})

Deno.test('device parsing covers desktop, mobile, tablet, unknown and client hints', () => {
  const desktop = normalizeDeviceMetadata(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/123.0.0.0 Safari/537.36',
    {},
    'Full HD',
  )
  if (desktop.device_type !== 'Desktop' || desktop.operating_system !== 'Windows') throw new Error('Windows UA fallback must not overstate Windows version.')

  const mobile = normalizeDeviceMetadata(
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1',
    { mobile: true, platform: 'iOS', model: 'iPhone' },
    'Mobile',
  )
  if (mobile.device_type !== 'Mobile' || mobile.operating_system !== 'iOS' || mobile.browser !== 'Safari') {
    throw new Error('iPhone information was not normalized.')
  }
  if (mobile.device_model !== 'iPhone') throw new Error('An explicitly exposed model may be stored.')

  const tablet = normalizeDeviceMetadata(
    'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Safari/604.1',
    { mobile: false },
    'QHD',
  )
  if (tablet.device_type !== 'Tablet') throw new Error('iPad should be categorized as a tablet.')

  const unknown = normalizeDeviceMetadata('', {}, 'Other')
  if (unknown.device_type !== 'Unknown' || unknown.operating_system !== 'Unknown' || unknown.browser !== 'Unknown') {
    throw new Error('Unavailable metadata should remain unknown.')
  }
  if (unknown.device_model !== 'Unknown') throw new Error('Unavailable model should remain unknown.')

  const edge = normalizeDeviceMetadata('', {
    fullVersionList: [{ brand: 'Microsoft Edge', version: '122.0.0.0' }],
    platform: 'Windows',
    platformVersion: '10.0.0',
  }, 'HD')
  if (edge.browser !== 'Microsoft Edge' || edge.operating_system !== 'Windows 10') {
    throw new Error('User-agent client hints should identify supported browser and OS versions.')
  }

  const browserCases: Array<[string, string, string]> = [
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/123.0.0.0 Safari/537.36 Edg/123.0.0.0', 'Microsoft Edge', 'Windows'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/123.0.0.0 Safari/537.36 OPR/109.0.0.0', 'Opera', 'Windows'],
    ['Mozilla/5.0 (X11; Linux x86_64; rv:124.0) Gecko/20100101 Firefox/124.0', 'Mozilla Firefox', 'Linux'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 13_0) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15', 'Safari', 'macOS'],
    ['Unknown Browser/1.0', 'Other', 'Unknown'],
  ]
  for (const [userAgent, expectedBrowser, expectedOs] of browserCases) {
    const metadata = normalizeDeviceMetadata(userAgent, {}, 'HD')
    if (metadata.browser !== expectedBrowser || metadata.operating_system !== expectedOs) {
      throw new Error(`Failed to normalize ${expectedBrowser} / ${expectedOs}.`)
    }
  }

  const android = normalizeDeviceMetadata(
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/123.0.0.0 Mobile Safari/537.36',
    { mobile: true, platform: 'Android', model: 'Pixel 8' },
    'Mobile',
  )
  if (android.device_type !== 'Mobile' || android.operating_system !== 'Android') {
    throw new Error('Android mobile information was not normalized.')
  }
})
