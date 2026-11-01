import {
  constantTimeEqual,
  decodeOwnershipSecret,
  getTrustedClientIp,
  getSupabaseSecretKey,
  hmacHex,
  isValidClientIp,
  toVisitRecord,
} from './security.ts'

Deno.test('accepts a secret-key default credential from SUPABASE_SECRET_KEYS', () => {
  const suffix = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '')
  const secretKey = `sb_secret_${suffix}`
  if (getSupabaseSecretKey(JSON.stringify({ default: secretKey })) !== secretKey) {
    throw new Error('Rejected a valid-format Supabase secret key.')
  }
})

Deno.test('accepts a legacy service-role JWT in the default credential', () => {
  const encode = (value: Record<string, string>) => btoa(JSON.stringify(value))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '')
  const legacyKey = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ iss: 'supabase', role: 'service_role' })}.${'A'.repeat(32)}`
  if (getSupabaseSecretKey(JSON.stringify({ default: legacyKey })) !== legacyKey) {
    throw new Error('Rejected a legacy service-role JWT.')
  }
})

Deno.test('rejects invalid credentials, malformed JSON, and a missing default key', () => {
  const encode = (value: Record<string, string>) => btoa(JSON.stringify(value))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '')
  const anonJwt = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ iss: 'supabase', role: 'anon' })}.${'A'.repeat(32)}`
  const invalidCredentials = [
    anonJwt,
    'sb_secret_',
    `sb_publishable_${'A'.repeat(32)}`,
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJvbGUiOiJhbm9uIn0.signature',
    'not-a-key',
  ]
  for (const credential of invalidCredentials) {
    if (getSupabaseSecretKey(JSON.stringify({ default: credential }))) {
      throw new Error('Accepted an invalid or non-privileged Supabase credential.')
    }
  }
  if (getSupabaseSecretKey('{invalid json')) throw new Error('Accepted malformed JSON.')
  if (getSupabaseSecretKey(JSON.stringify({ other: `sb_secret_${'A'.repeat(32)}` }))) {
    throw new Error('Accepted a credential without the default entry.')
  }
  if (getSupabaseSecretKey(JSON.stringify({ default: '' }))) {
    throw new Error('Accepted an empty default credential.')
  }
  if (getSupabaseSecretKey(JSON.stringify({ default: 42 }))) {
    throw new Error('Accepted a non-string default credential.')
  }
})

Deno.test('accepts a device-only visit and rejects legacy location or IP fields', () => {
  const record = {
    event: 'visit',
    visit_id: 'fc3c769a-df3f-4f06-9db6-fc88e7bd53d0',
    visitor_id: '6a740347-57f8-4510-9bd9-3e6e28091247',
    session_id: '57aa80d5-02cf-4ba7-9482-7f6d5bd79909',
    ownership_token: 'a'.repeat(64),
    first_visited_at: null,
    page_path: '/',
    device_type: 'unknown',
    device_brand: 'Unknown',
    device_model: 'Unknown',
    operating_system: 'Unknown',
    os_version: '',
    browser: 'Unknown',
    browser_version: '',
    screen_width: null,
    screen_height: null,
    viewport_width: 1280,
    viewport_height: 720,
    device_pixel_ratio: 1,
    language: 'en',
  }
  const visit = toVisitRecord(record)
  if (!visit || 'ownership_token' in visit) throw new Error('Rejected a valid device-only visit or returned its ownership token.')
  if (toVisitRecord({ ...record, latitude: 0 })) throw new Error('Accepted a GPS field.')
  if (toVisitRecord({ ...record, ip_address: '203.0.113.1' })) throw new Error('Accepted an IP field.')
  if (toVisitRecord({ ...record, viewport_width: 20001 })) throw new Error('Accepted an out-of-range viewport.')
})

Deno.test('accepts a high-entropy 32-byte base64url ownership secret without changing its HMAC bytes', async () => {
  const randomBytes = crypto.getRandomValues(new Uint8Array(32))
  const secret = btoa(String.fromCharCode(...randomBytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '')
  const decoded = decodeOwnershipSecret(secret)
  if (!decoded || decoded.length !== 43) throw new Error('Expected a validated 32-byte secret in its original HMAC representation.')
  const actual = await hmacHex(decoded, 'compatibility-check')
  const expected = await hmacHex(new TextEncoder().encode(secret), 'compatibility-check')
  if (!constantTimeEqual(actual, expected)) throw new Error('Changed the existing HMAC representation.')
})

Deno.test('accepts a high-entropy 32-byte hexadecimal ownership secret', () => {
  const randomBytes = crypto.getRandomValues(new Uint8Array(32))
  const secret = Array.from(randomBytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  if (!decodeOwnershipSecret(secret)) throw new Error('Rejected a valid 32-byte hexadecimal secret.')
})

Deno.test('rejects short, repeated, and placeholder ownership secrets', () => {
  if (decodeOwnershipSecret('short')) throw new Error('Accepted a short secret.')
  if (decodeOwnershipSecret('A'.repeat(43))) throw new Error('Accepted a repeated secret.')
  if (decodeOwnershipSecret('0'.repeat(64))) throw new Error('Accepted a repeated hexadecimal secret.')
  const phrase = btoa('This is a predictable passphrase')
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '')
  if (decodeOwnershipSecret(phrase)) throw new Error('Accepted a predictable passphrase.')
})

Deno.test('verifies ownership HMAC values and rejects mismatches', async () => {
  const secret = crypto.getRandomValues(new Uint8Array(32))
  const first = await hmacHex(secret, 'visitor-owner:example')
  const second = await hmacHex(secret, 'visitor-owner:example')
  const other = await hmacHex(secret, 'visitor-owner:other')
  if (!constantTimeEqual(first, second)) throw new Error('Expected matching HMACs.')
  if (constantTimeEqual(first, other)) throw new Error('Accepted a mismatched HMAC.')
})

Deno.test('validates IP syntax and only reads the gateway header', () => {
  if (!isValidClientIp('203.0.113.12')) throw new Error('Rejected valid IPv4.')
  if (!isValidClientIp('2001:db8::1')) throw new Error('Rejected valid IPv6.')
  if (isValidClientIp('999.1.1.1')) throw new Error('Accepted invalid IPv4.')
  if (isValidClientIp('2001:::1')) throw new Error('Accepted invalid IPv6.')

  const forwardedOnly = new Request('https://example.test', {
    headers: { 'x-forwarded-for': '203.0.113.12' },
  })
  if (getTrustedClientIp(forwardedOnly) !== null) throw new Error('Trusted a client forwarding header.')

  const gatewayHeader = new Request('https://example.test', {
    headers: { 'cf-connecting-ip': '203.0.113.12', 'x-forwarded-for': '198.51.100.4' },
  })
  if (getTrustedClientIp(gatewayHeader) !== '203.0.113.12') throw new Error('Did not use the gateway header.')
})
