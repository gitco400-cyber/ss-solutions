import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.118.0'
import { getTrustedClientIp } from '../contact-submit/handler.ts'
import { createVisitorAnalyticsHandler } from './handler.ts'

function requiredEnv(name: string): string {
  const value = Deno.env.get(name)
  if (!value) throw new Error(`Missing required Edge Function environment variable: ${name}`)
  return value
}

function decodeHmacSecret(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) {
    throw new Error('VISITOR_ANALYTICS_RATE_LIMIT_HMAC_SECRET must encode 32 random bytes.')
  }
  const bytes = Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='), (character) => character.charCodeAt(0))
  const canonical = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
  if (bytes.byteLength !== 32 || canonical !== value) {
    throw new Error('VISITOR_ANALYTICS_RATE_LIMIT_HMAC_SECRET must be canonical base64url.')
  }
  return bytes
}

const supabaseUrl = requiredEnv('SUPABASE_URL')
const serviceRoleKey = requiredEnv('SUPABASE_SERVICE_ROLE_KEY')
const trustedHeader = Deno.env.get('VISITOR_ANALYTICS_TRUSTED_IP_HEADER') ?? ''
const ingressVerified = Deno.env.get('VISITOR_ANALYTICS_TRUSTED_IP_HEADER_VERIFIED') === 'true'
const allowedOrigins = new Set([
  'https://gitco200-cyber.github.io',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
])

let hmacKey: CryptoKey | null = null
if (trustedHeader === 'cf-connecting-ip' && ingressVerified) {
  const secret = decodeHmacSecret(requiredEnv('VISITOR_ANALYTICS_RATE_LIMIT_HMAC_SECRET'))
  const keyBuffer = new ArrayBuffer(secret.byteLength)
  new Uint8Array(keyBuffer).set(secret)
  hmacKey = await crypto.subtle.importKey('raw', keyBuffer, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})
const encoder = new TextEncoder()

const handleRequest = createVisitorAnalyticsHandler({
  allowedOrigins,
  getClientIp: (request) => getTrustedClientIp(request, trustedHeader, ingressVerified),
  hashIp: async (ip) => {
    if (!hmacKey) throw new Error('Trusted ingress is not verified.')
    const signature = await crypto.subtle.sign('HMAC', hmacKey, encoder.encode(`ss-solutions:visitor-analytics:ip:${ip}`))
    return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  },
  consumeRateLimit: async (ipHash) => {
    const { data, error } = await supabase.rpc('consume_visitor_analytics_rate_limit', { p_ip_hash: ipHash })
    if (error) throw error
    if (data === 'allowed' || data === 'limited' || data === 'capacity') return data
    throw new Error('Visitor analytics rate-limit RPC returned an invalid result.')
  },
  recordConsent: async (visitorId) => {
    const { error } = await supabase.rpc('record_visitor_analytics_consent', { p_visitor_id: visitorId })
    if (error) throw error
  },
  isConsented: async (visitorId) => {
    const { data, error } = await supabase.rpc('is_visitor_analytics_consented', { p_visitor_id: visitorId })
    if (error) throw error
    if (typeof data !== 'boolean') throw new Error('Visitor consent check returned an invalid result.')
    return data
  },
  revokeConsent: async (visitorId) => {
    const { error } = await supabase.rpc('revoke_visitor_analytics_consent', { p_visitor_id: visitorId })
    if (error) throw error
  },
  insertVisit: async (visit) => {
    const { error } = await supabase.from('visitor_analytics').upsert(visit, {
      onConflict: 'visit_id',
      ignoreDuplicates: true,
    })
    if (error) throw error
  },
})

Deno.serve(handleRequest)
