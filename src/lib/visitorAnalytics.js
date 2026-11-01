import { isSupabaseConfigured, supabase } from './supabase.js'

const visitorIdKey = 'ss-solutions-visitor-id'
const ownershipTokenKey = 'ss-solutions-visitor-owner-token'
const firstVisitKey = 'ss-solutions-first-visit'
const sessionIdKey = 'ss-solutions-visit-session'
let visitorIdentityPromise
let pageVisitPromise

function createUuid() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function getStoredId(storage, key) {
  try {
    let value = storage.getItem(key)
    if (!value) {
      value = createUuid()
      storage.setItem(key, value)
    }
    return value
  } catch {
    return createUuid()
  }
}

function getStoredIdFromBrowser(storageName, key) {
  try {
    return getStoredId(window[storageName], key)
  } catch {
    return createUuid()
  }
}

function getFirstVisitAt() {
  try {
    const stored = localStorage.getItem(firstVisitKey)
    if (stored && Number.isFinite(Date.parse(stored))) return stored
    const now = new Date().toISOString()
    localStorage.setItem(firstVisitKey, now)
    return now
  } catch {
    return null
  }
}

async function getVisitorIdentity() {
  if (visitorIdentityPromise) return visitorIdentityPromise
  visitorIdentityPromise = (async () => {
    try {
      const visitorId = localStorage.getItem(visitorIdKey)
      const ownershipToken = localStorage.getItem(ownershipTokenKey)
      if (visitorId && ownershipToken
        && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(visitorId)
        && /^[0-9a-f]{64}$/.test(ownershipToken)) {
        return { visitorId, ownershipToken }
      }

      const { data, error } = await supabase.functions.invoke('visitor-analytics', { body: { event: 'initialize' } })
      if (error) throw error
      if (!data
        || typeof data.visitor_id !== 'string'
        || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(data.visitor_id)
        || typeof data.ownership_token !== 'string'
        || !/^[0-9a-f]{64}$/.test(data.ownership_token)) {
        throw new Error('The visitor identity could not be initialized.')
      }
      localStorage.setItem(visitorIdKey, data.visitor_id)
      localStorage.setItem(ownershipTokenKey, data.ownership_token)
      return { visitorId: data.visitor_id, ownershipToken: data.ownership_token }
    } catch (error) {
      visitorIdentityPromise = null
      throw error
    }
  })()
  return visitorIdentityPromise
}

function browserFromUserAgent(userAgent) {
  const rules = [
    ['Microsoft Edge', /Edg(?:A|iOS)?\/([\d.]+)/],
    ['Opera', /(?:OPR|Opera)\/([\d.]+)/],
    ['Samsung Internet', /SamsungBrowser\/([\d.]+)/],
    ['Firefox', /(?:Firefox|FxiOS)\/([\d.]+)/],
    ['Google Chrome', /(?:Chrome|CriOS)\/([\d.]+)/],
    ['Safari', /Version\/([\d.]+).*Safari/],
  ]
  for (const [name, pattern] of rules) {
    const match = userAgent.match(pattern)
    if (match) return { name, version: match[1] }
  }
  return { name: 'Unknown', version: '' }
}

function operatingSystemFromUserAgent(userAgent) {
  const rules = [
    ['iOS', /(?:iPhone|iPad|iPod).*?OS ([\d_]+)/],
    ['Android', /Android(?:\s|\/)([\d.]+)/],
    ['Windows', /Windows NT ([\d.]+)/],
    ['macOS', /Mac OS X ([\d_]+)/],
    ['Linux', /Linux/],
  ]
  for (const [name, pattern] of rules) {
    const match = userAgent.match(pattern)
    if (match) return { name, version: (match[1] ?? '').replaceAll('_', '.') }
  }
  return { name: 'Unknown', version: '' }
}

function getDeviceType(userAgent, isMobileHint, isDesktopModeTablet) {
  if (!userAgent && isMobileHint === undefined) return 'unknown'
  if (isMobileHint === true) return 'mobile'
  if (/iPad|Tablet|PlayBook|Silk/i.test(userAgent) || (/Android/i.test(userAgent) && !/Mobile/i.test(userAgent)) || isDesktopModeTablet) return 'tablet'
  if (/Mobile|iPhone|iPod|Windows Phone/i.test(userAgent)) return 'mobile'
  if (/Windows|Macintosh|Mac OS X|Linux|CrOS|X11/i.test(userAgent)) return 'desktop'
  return 'unknown'
}

async function getClientHints() {
  const userAgentData = navigator.userAgentData
  if (!userAgentData?.getHighEntropyValues) return {}
  try {
    return await userAgentData.getHighEntropyValues(['model', 'platformVersion', 'fullVersionList'])
  } catch {
    return {}
  }
}

export async function createVisitorRecord() {
  if (!isSupabaseConfigured || !supabase || typeof window === 'undefined') return null
  if (pageVisitPromise) return pageVisitPromise
  pageVisitPromise = (async () => {
    const identity = await getVisitorIdentity()
    const sessionId = getStoredIdFromBrowser('sessionStorage', sessionIdKey)
    const firstVisitedAt = getFirstVisitAt()
    const userAgent = navigator.userAgent || ''
    const hints = await getClientHints()
    const browserFallback = browserFromUserAgent(userAgent)
    const operatingSystemFallback = /Macintosh/i.test(userAgent) && navigator.maxTouchPoints > 1
      ? { name: 'iPadOS', version: '' }
      : operatingSystemFromUserAgent(userAgent)
    const versionHints = Array.isArray(hints.fullVersionList) ? hints.fullVersionList : []
    const browserHint = versionHints.find((item) => /Microsoft Edge/i.test(item.brand))
      ?? versionHints.find((item) => /Google Chrome/i.test(item.brand))
      ?? versionHints.find((item) => /Opera|Samsung Internet/i.test(item.brand))
    const model = typeof hints.model === 'string' && hints.model.trim() ? hints.model.trim().slice(0, 120) : 'Unknown'
    const platform = typeof hints.platform === 'string' ? hints.platform : ''
    const operatingSystem = platform || operatingSystemFallback.name
    const osVersion = hints.platformVersion || operatingSystemFallback.version
    const language = navigator.language || 'Unknown'

    return {
      visit_id: createUuid(),
      visitor_id: identity.visitorId,
      ownership_token: identity.ownershipToken,
      session_id: sessionId,
      first_visited_at: firstVisitedAt,
      page_path: `${window.location.pathname}`.slice(0, 512),
      device_type: getDeviceType(userAgent, navigator.userAgentData?.mobile, navigator.maxTouchPoints > 1 && /Macintosh/i.test(userAgent)),
      device_brand: 'Unknown',
      device_model: model,
      operating_system: operatingSystem.slice(0, 80),
      os_version: String(osVersion).slice(0, 80),
      browser: (browserHint?.brand || browserFallback.name).slice(0, 80),
      browser_version: (browserHint?.version || browserFallback.version).slice(0, 80),
      screen_width: Number.isInteger(window.screen?.width) ? window.screen.width : null,
      screen_height: Number.isInteger(window.screen?.height) ? window.screen.height : null,
      viewport_width: Number.isInteger(window.innerWidth) ? window.innerWidth : null,
      viewport_height: Number.isInteger(window.innerHeight) ? window.innerHeight : null,
      device_pixel_ratio: Number.isFinite(window.devicePixelRatio) ? window.devicePixelRatio : null,
      language: language.slice(0, 40),
    }
  })().catch((error) => {
    pageVisitPromise = null
    throw error
  })
  return pageVisitPromise
}

export async function submitVisitorEvent(record) {
  if (!record || !supabase) return { error: new Error('Visitor analytics is not configured.') }
  try {
    return await supabase.functions.invoke('visitor-analytics', {
      body: { ...record, event: 'visit' },
    })
  } catch (error) {
    return { data: null, error }
  }
}
