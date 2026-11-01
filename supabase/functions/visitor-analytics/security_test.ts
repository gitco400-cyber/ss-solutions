import {
  constantTimeEqual,
  decodeOwnershipSecret,
  getTrustedClientIp,
  hmacHex,
  isValidClientIp,
} from './security.ts'

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
