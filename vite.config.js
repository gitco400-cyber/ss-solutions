import { Buffer } from 'node:buffer'
import process from 'node:process'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

function isPublicSupabaseKey(value) {
  if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(value)) return true
  const segments = value.split('.')
  if (segments.length !== 3) return false
  try {
    const payload = JSON.parse(Buffer.from(segments[1], 'base64url').toString('utf8'))
    return payload.role === 'anon'
  } catch {
    return false
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const publicKey = env.VITE_SUPABASE_ANON_KEY
  if (publicKey && !isPublicSupabaseKey(publicKey)) {
    throw new Error('VITE_SUPABASE_ANON_KEY must be a Supabase publishable or legacy anon key. Refusing to expose a non-public key in frontend assets.')
  }

  return {
    plugins: [react(), tailwindcss()],
    base: '/ss-solutions/',
  }
})