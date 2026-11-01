const publicSiteSyncEvent = 'ss-solutions:public-site-sync'
const publicSiteSyncStorageKey = 'ss-solutions:public-site-sync'
const inFlightPublicSiteRequests = new Map()

const publicSiteQueries = {
  services: (supabase) => supabase.from('services').select('*').eq('is_active', true).order('sort_order'),
  projects: (supabase) => supabase.from('projects').select('*').eq('is_published', true).order('sort_order'),
  socialLinks: (supabase) => supabase.from('social_links').select('*').eq('enabled', true).order('sort_order'),
  settings: (supabase) => supabase.from('site_settings').select('key, value').in('key', ['site_content', 'seo']),
}

export function fetchPublicSiteData(supabase, sources = Object.keys(publicSiteQueries)) {
  const requestedSources = [...new Set(sources)].filter((source) => source in publicSiteQueries).sort()
  const requestKey = requestedSources.join(',')
  let request = inFlightPublicSiteRequests.get(requestKey)

  if (!request) {
    request = Promise.allSettled(requestedSources.map((source) => publicSiteQueries[source](supabase)))
      .then((results) => Object.fromEntries(requestedSources.map((source, index) => [source, results[index]])))
    inFlightPublicSiteRequests.set(requestKey, request)
    request.finally(() => {
      if (inFlightPublicSiteRequests.get(requestKey) === request) inFlightPublicSiteRequests.delete(requestKey)
    })
  }

  return request
}

export function notifyPublicSiteChanged(source = 'all') {
  if (typeof window === 'undefined') return

  const detail = { source, timestamp: Date.now() }
  window.dispatchEvent(new CustomEvent(publicSiteSyncEvent, { detail }))
  try {
    window.localStorage.setItem(publicSiteSyncStorageKey, JSON.stringify(detail))
  } catch {
    // Same-tab refresh remains available when browser storage is disabled.
  }
}

export function subscribeToPublicSiteChanges(callback) {
  if (typeof window === 'undefined') return () => {}

  const handleLocalChange = (event) => callback(event.detail?.source ?? 'all')
  const handleStorageChange = (event) => {
    if (event.key === publicSiteSyncStorageKey) {
      try {
        callback(JSON.parse(event.newValue).source ?? 'all')
      } catch {
        callback('all')
      }
    }
  }

  window.addEventListener(publicSiteSyncEvent, handleLocalChange)
  window.addEventListener('storage', handleStorageChange)

  return () => {
    window.removeEventListener(publicSiteSyncEvent, handleLocalChange)
    window.removeEventListener('storage', handleStorageChange)
  }
}
