import {
  createContactSubmitHandler,
  getTrustedClientIp,
  parseTrustedIp,
  type ContactSubmission,
} from './handler.ts'

const allowedOrigins = new Set(['http://localhost:5173'])
const validPayload = {
  name: '  Jane Doe ',
  email: ' JANE@example.com ',
  phone: '+1 555 123 4567',
  service: 'Web Development',
  message: 'I would like to discuss a new website project.',
  website: '',
}

function makeHandler(overrides: {
  clientIp?: string | null
  withinLimit?: boolean
  rateLimitResult?: 'allowed' | 'limited' | 'capacity'
  failHash?: boolean
  failRateLimit?: boolean
  failInquiry?: boolean
} = {}) {
  const submitted: ContactSubmission[] = []
  let rateLimitCalls = 0
  const handler = createContactSubmitHandler({
    allowedOrigins,
    getClientIp: () => overrides.clientIp === undefined ? '192.0.2.10' : overrides.clientIp,
    hashIdentifier: async (kind, value) => {
      if (overrides.failHash) throw new Error('HMAC unavailable.')
      return `${kind}:${value}`
    },
    consumeRateLimit: async (ipHash, emailHash) => {
      rateLimitCalls += 1
      if (overrides.failRateLimit) throw new Error('Rate-limit storage unavailable.')
      if (ipHash !== 'ip:192.0.2.10' || emailHash !== 'email:jane@example.com') {
        throw new Error('Unexpected rate-limit keys.')
      }
      return overrides.rateLimitResult
        ?? (overrides.withinLimit === false ? 'limited' : 'allowed')
    },
    submitInquiry: async (submission) => {
      if (overrides.failInquiry) throw new Error('Inquiry storage unavailable.')
      submitted.push(submission)
    },
  })

  return {
    handler,
    submitted,
    get rateLimitCalls() { return rateLimitCalls },
  }
}

function post(payload: unknown): Request {
  return new Request('http://localhost/functions/v1/contact-submit', {
    method: 'POST',
    headers: {
      origin: 'http://localhost:5173',
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
}

Deno.test('valid submissions are normalized, rate limited, and stored', async () => {
  const fixture = makeHandler()
  const response = await fixture.handler(post(validPayload))

  if (response.status !== 200 || fixture.submitted.length !== 1 || fixture.rateLimitCalls !== 1) {
    throw new Error('Expected one accepted and rate-limited submission.')
  }
  const saved = fixture.submitted[0]
  if (saved.name !== 'Jane Doe' || saved.email !== 'jane@example.com' || saved.phone !== '+1 555 123 4567') {
    throw new Error('Expected normalized contact fields.')
  }
})

Deno.test('honeypot submissions are acknowledged but never rate limited or stored', async () => {
  const fixture = makeHandler()
  const response = await fixture.handler(post({ ...validPayload, website: 'bot-filled-this' }))

  if (response.status !== 200 || fixture.submitted.length !== 0 || fixture.rateLimitCalls !== 0) {
    throw new Error('Honeypot submission was not safely discarded.')
  }
})

Deno.test('rate-limited submissions are not stored', async () => {
  const fixture = makeHandler({ withinLimit: false })
  const response = await fixture.handler(post(validPayload))

  if (response.status !== 429 || fixture.submitted.length !== 0 || fixture.rateLimitCalls !== 1) {
    throw new Error('Expected rate-limited submission to be rejected before insertion.')
  }
})

Deno.test('rate-limit capacity fails closed without storing the inquiry', async () => {
  const fixture = makeHandler({ rateLimitResult: 'capacity' })
  const response = await fixture.handler(post(validPayload))

  if (response.status !== 503 || fixture.submitted.length !== 0 || fixture.rateLimitCalls !== 1) {
    throw new Error('Submission was accepted when rate-limit storage was full.')
  }
})

Deno.test('invalid input is rejected before rate limiting or storage', async () => {
  const fixture = makeHandler()
  const response = await fixture.handler(post({ ...validPayload, email: 'not-an-email' }))

  if (response.status !== 400 || fixture.submitted.length !== 0 || fixture.rateLimitCalls !== 0) {
    throw new Error('Invalid input reached the rate limiter or database.')
  }
})

Deno.test('changing email does not bypass the trusted-IP rate limit', async () => {
  let ipRequests = 0
  const submitted: ContactSubmission[] = []
  const handler = createContactSubmitHandler({
    allowedOrigins,
    getClientIp: () => '192.0.2.10',
    hashIdentifier: async (kind, value) => `${kind}:${value}`,
    consumeRateLimit: async (ipHash) => {
      if (ipHash !== 'ip:192.0.2.10') throw new Error('Expected the same IP rate-limit key.')
      ipRequests += 1
      return ipRequests <= 10 ? 'allowed' : 'limited'
    },
    submitInquiry: async (submission) => { submitted.push(submission) },
  })

  const responses = []
  for (let index = 0; index < 11; index += 1) {
    responses.push(await handler(post({
      ...validPayload,
      email: `visitor${index}@example.com`,
    })))
  }

  if (responses[10].status !== 429 || submitted.length !== 10) {
    throw new Error('Changing email bypassed the trusted-IP rate limit.')
  }
})

Deno.test('submission fails closed when no trusted client IP is available', async () => {
  const fixture = makeHandler({ clientIp: null })
  const response = await fixture.handler(post(validPayload))

  if (response.status !== 503 || fixture.submitted.length !== 0 || fixture.rateLimitCalls !== 0) {
    throw new Error('Submission was accepted without a trusted client IP.')
  }
})

Deno.test('submission fails closed when HMAC generation fails', async () => {
  const fixture = makeHandler({ failHash: true })
  const response = await fixture.handler(post(validPayload))

  if (response.status !== 503 || fixture.submitted.length !== 0 || fixture.rateLimitCalls !== 0) {
    throw new Error('Submission was accepted without HMAC identifiers.')
  }
})

Deno.test('submission fails closed when rate-limit storage is unavailable', async () => {
  const fixture = makeHandler({ failRateLimit: true })
  const response = await fixture.handler(post(validPayload))

  if (response.status !== 503 || fixture.submitted.length !== 0 || fixture.rateLimitCalls !== 1) {
    throw new Error('Submission was accepted without rate-limit storage.')
  }
})

Deno.test('submission fails closed when inquiry storage is unavailable', async () => {
  const fixture = makeHandler({ failInquiry: true })
  const response = await fixture.handler(post(validPayload))

  if (response.status !== 503 || fixture.submitted.length !== 0 || fixture.rateLimitCalls !== 1) {
    throw new Error('Inquiry storage failure was reported as success.')
  }
})

Deno.test('oversized request bodies are rejected', async () => {
  const fixture = makeHandler()
  const request = new Request('http://localhost/functions/v1/contact-submit', {
    method: 'POST',
    headers: {
      origin: 'http://localhost:5173',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ ...validPayload, message: 'x'.repeat(20 * 1024) }),
  })
  const response = await fixture.handler(request)

  if (response.status !== 413 || fixture.submitted.length !== 0 || fixture.rateLimitCalls !== 0) {
    throw new Error('Oversized submission was not rejected before processing.')
  }
})

Deno.test('trusted IP parser rejects malformed and forwarded address lists', () => {
  if (parseTrustedIp('192.0.2.10') !== '192.0.2.10') throw new Error('Valid IPv4 was rejected.')
  if (!parseTrustedIp('2001:db8::1')) throw new Error('Valid IPv6 was rejected.')
  if (parseTrustedIp('192.0.2.10, 198.51.100.2') !== null) throw new Error('Forwarded IP list was accepted.')
  if (parseTrustedIp('not-an-ip') !== null) throw new Error('Invalid address was accepted.')
})

Deno.test('unverified ingress headers are never used as client IPs', () => {
  const request = new Request('http://localhost/functions/v1/contact-submit', {
    headers: { 'cf-connecting-ip': '192.0.2.10' },
  })
  if (getTrustedClientIp(request, 'cf-connecting-ip', false) !== null) {
    throw new Error('Unverified ingress IP header was trusted.')
  }
  if (getTrustedClientIp(request, 'x-forwarded-for', true) !== null) {
    throw new Error('An unapproved forwarded IP header was trusted.')
  }
  if (getTrustedClientIp(request, 'cf-connecting-ip', true) !== '192.0.2.10') {
    throw new Error('A verified ingress IP was rejected.')
  }
})
