import { supabase } from './supabase.js'

const consentStorageKey = 'ss-solutions-analytics-consent'
const visitorStorageKey = 'ss-solutions-visitor-id'
const sessionStorageKey = 'ss-solutions-visit-session'

export function readAnalyticsConsent() {
  try {
    const value = window.localStorage.getItem(consentStorageKey)
    if (value === 'accepted-v1') return true
    if (value === 'declined-v1') return false
    return null
  } catch {
    return null
  }
}

function createId() {
  if (!globalThis.crypto?.randomUUID) throw new Error('Secure random identifiers are not available.')
  return globalThis.crypto.randomUUID()
}

function getOrCreateStorageId(storage, key) {
  const existing = storage.getItem(key)
  if (existing && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(existing)) {
    return existing
  }
  const id = createId()
  storage.setItem(key, id)
  return id
}

export function clearAnalyticsIdentity() {
  try {
    window.localStorage.removeItem(visitorStorageKey)
    window.sessionStorage.removeItem(sessionStorageKey)
  } catch {
    return
  }
}

function getScreenCategory(mobile) {
  if (mobile) return 'Mobile'
  const width = window.screen?.width ?? 0
  const height = window.screen?.height ?? 0
  const longestSide = Math.max(width, height)
  if (longestSide >= 3840) return '4K'
  if (longestSide >= 2560) return 'QHD'
  if (longestSide >= 1920) return 'Full HD'
  if (longestSide >= 1280) return 'HD'
  return 'Other'
}

async function getClientHints() {
  const userAgentData = navigator.userAgentData
  if (!userAgentData) return { mobile: /Mobile|iPhone|iPod|Android/i.test(navigator.userAgent) }

  let highEntropy = {}
  if (typeof userAgentData.getHighEntropyValues === 'function') {
    try {
      highEntropy = await userAgentData.getHighEntropyValues(['platformVersion', 'model', 'fullVersionList'])
    } catch {
      highEntropy = {}
    }
  }

  return {
    mobile: Boolean(userAgentData.mobile),
    platform: userAgentData.platform,
    platformVersion: highEntropy.platformVersion,
    model: highEntropy.model,
    brands: userAgentData.brands,
    fullVersionList: highEntropy.fullVersionList,
  }
}

async function invokeAnalytics(body) {
  if (!supabase) return
  const { data, error } = await supabase.functions.invoke('visitor-analytics', { body })
  if (error || !data?.ok) throw new Error('Optional analytics request failed.')
}

export async function registerAnalyticsConsent(visitorId) {
  await invokeAnalytics({ action: 'consent', visitor_id: visitorId })
}

export async function revokeAnalyticsConsent(visitorId) {
  await invokeAnalytics({ action: 'revoke', visitor_id: visitorId })
}

export async function recordCurrentVisit() {
  if (!supabase) return

  const visitorId = getOrCreateStorageId(window.localStorage, visitorStorageKey)
  const sessionId = getOrCreateStorageId(window.sessionStorage, sessionStorageKey)
  const clientHints = await getClientHints()
  const visitId = createId()

  await invokeAnalytics({
    action: 'visit',
    visitor_id: visitorId,
    session_id: sessionId,
    visit_id: visitId,
    page_path: window.location.pathname,
    screen_category: getScreenCategory(clientHints.mobile),
    client_hints: clientHints,
  })
}

export function getAnalyticsVisitorId() {
  try {
    return window.localStorage.getItem(visitorStorageKey)
  } catch {
    return null
  }
}
