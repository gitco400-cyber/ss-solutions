import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.118.0'
import { createContactSubmitHandler, getTrustedClientIp } from './handler.ts'

function requiredEnv(name: string): string {
  const value = Deno.env.get(name)
  if (!value) throw new Error(`Missing required Edge Function environment variable: ${name}`)
  return value
}

function decodeHmacSecret(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) {
    throw new Error('CONTACT_RATE_LIMIT_HMAC_SECRET must be a canonical base64url-encoded 32-byte secret.')
  }
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/') + '='
  const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0))
  const canonical = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
  if (bytes.byteLength !== 32 || canonical !== value) {
    throw new Error('CONTACT_RATE_LIMIT_HMAC_SECRET must be a canonical base64url-encoded 32-byte secret.')
  }
  return bytes
}

const supabaseUrl = requiredEnv('SUPABASE_URL')
const serviceRoleKey = requiredEnv('SUPABASE_SERVICE_ROLE_KEY')
const hmacSecretBytes = decodeHmacSecret(requiredEnv('CONTACT_RATE_LIMIT_HMAC_SECRET'))
const trustedIpHeader = requiredEnv('CONTACT_TRUSTED_IP_HEADER')
const trustedIpHeaderVerified = requiredEnv('CONTACT_TRUSTED_IP_HEADER_VERIFIED')
if (trustedIpHeader !== 'cf-connecting-ip') {
  throw new Error('CONTACT_TRUSTED_IP_HEADER must identify the verified ingress client-IP header.')
}
if (trustedIpHeaderVerified !== 'true') {
  throw new Error('Contact submissions are disabled until the trusted client-IP ingress header is verified.')
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})
const encoder = new TextEncoder()
const hmacKeyBuffer = new ArrayBuffer(hmacSecretBytes.byteLength)
new Uint8Array(hmacKeyBuffer).set(hmacSecretBytes)
const hmacKey = await crypto.subtle.importKey(
  'raw',
  hmacKeyBuffer,
  { name: 'HMAC', hash: 'SHA-256' },
  false,
  ['sign'],
)
const allowedOrigins = new Set([
  'https://gitco200-cyber.github.io',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
])

async function hashIdentifier(kind: 'ip' | 'email', value: string): Promise<string> {
  const signature = await crypto.subtle.sign(
    'HMAC',
    hmacKey,
    encoder.encode(`ss-solutions:contact:${kind}:${value}`),
  )
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

const handleRequest = createContactSubmitHandler({
  allowedOrigins,
  getClientIp: (request) => getTrustedClientIp(
    request,
    trustedIpHeader,
    trustedIpHeaderVerified === 'true',
  ),
  hashIdentifier,
  consumeRateLimit: async (ipHash, emailHash) => {
    const { data, error } = await supabase.rpc('consume_contact_submission_rate_limit', {
      p_ip_hash: ipHash,
      p_email_hash: emailHash,
    })
    if (error) throw error
    if (data === 'allowed' || data === 'limited' || data === 'capacity') return data
    throw new Error('Contact rate-limit RPC returned an invalid result.')
  },
  submitInquiry: async (submission) => {
    const { error } = await supabase.from('inquiries').insert(submission)
    if (error) throw error
  },
})

Deno.serve(handleRequest)
