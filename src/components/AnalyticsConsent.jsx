import { useEffect, useState } from 'react'
import {
  clearAnalyticsIdentity,
  getAnalyticsVisitorId,
  readAnalyticsConsent,
  recordCurrentVisit,
  registerAnalyticsConsent,
  revokeAnalyticsConsent,
} from '../lib/visitorAnalytics.js'
import { supabase } from '../lib/supabase.js'
import './analytics-consent.css'

function storeConsent(accepted) {
  try {
    window.localStorage.setItem('ss-solutions-analytics-consent', accepted ? 'accepted-v1' : 'declined-v1')
  } catch {
    return false
  }
  return true
}

function AnalyticsConsent() {
  const [decision, setDecision] = useState(readAnalyticsConsent)
  const [isOpen, setIsOpen] = useState(decision === null)
  const [message, setMessage] = useState('')

  useEffect(() => {
    const openPreferences = () => {
      setMessage('')
      setIsOpen(true)
    }
    window.addEventListener('ss-solutions:open-analytics-preferences', openPreferences)
    return () => window.removeEventListener('ss-solutions:open-analytics-preferences', openPreferences)
  }, [])

  useEffect(() => {
    if (decision !== true || !supabase) return undefined

    let active = true
    async function recordVisit() {
      try {
        const visitorId = getAnalyticsVisitorId()
        if (!visitorId) throw new Error('Visitor ID is unavailable.')
        await registerAnalyticsConsent(visitorId)
        if (active) await recordCurrentVisit()
      } catch {
        console.warn('Optional visitor analytics could not be recorded.')
      }
    }
    recordVisit()
    return () => { active = false }
  }, [decision])

  if (!supabase || !isOpen) return null

  async function acceptAnalytics() {
    if (!storeConsent(true)) {
      setMessage('Your preference could not be saved in this browser.')
      return
    }
    setDecision(true)
    setMessage('')
    setIsOpen(false)
  }

  function declineAnalytics() {
    if (!storeConsent(false)) {
      setMessage('Your preference could not be saved in this browser.')
      return
    }
    setDecision(false)
    setMessage('')
    setIsOpen(false)
  }

  async function withdrawAnalytics() {
    const visitorId = getAnalyticsVisitorId()
    try {
      if (visitorId) await revokeAnalyticsConsent(visitorId)
    } catch {
      setMessage('Analytics is disabled in this browser, but earlier records may remain until the 90-day retention cleanup.')
    }
    storeConsent(false)
    clearAnalyticsIdentity()
    setDecision(false)
  }

  return (
    <aside aria-label="Analytics privacy preferences" className="analytics-consent-panel" role="dialog">
      <button aria-label="Close analytics preferences" className="analytics-consent-close" onClick={() => setIsOpen(false)} type="button">×</button>
      <span className="analytics-consent-eyebrow">Privacy choice</span>
      <h2>Optional device analytics</h2>
      <p>With your permission, we record coarse device, browser, operating system, and screen categories to understand how the website is used. We do not store your IP address, precise screen dimensions, location, or GPS data. Visits are retained for up to 90 days.</p>
      {message && <p className="analytics-consent-message" role="status">{message}</p>}
      <div className="analytics-consent-actions">
        {decision === true
          ? <button className="analytics-consent-decline" onClick={withdrawAnalytics} type="button">Disable and delete my analytics</button>
          : <>
            <button className="analytics-consent-accept" onClick={acceptAnalytics} type="button">Allow optional analytics</button>
            <button className="analytics-consent-decline" onClick={declineAnalytics} type="button">Not now</button>
          </>}
      </div>
    </aside>
  )
}

export default AnalyticsConsent
