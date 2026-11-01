import { useCallback, useEffect, useRef, useState } from 'react'
import { MapPin, ShieldCheck, X } from 'lucide-react'
import { isSupabaseConfigured } from '../lib/supabase.js'
import { createVisitorRecord, submitVisitorEvent } from '../lib/visitorAnalytics.js'
import './VisitorLocation.css'

const consentKey = 'ss-solutions-location-consent'

function getConsent() {
  try {
    return localStorage.getItem(consentKey) || ''
  } catch {
    return ''
  }
}

function saveConsent(value) {
  try {
    localStorage.setItem(consentKey, value)
  } catch {
    return
  }
}

function getLocationError(error) {
  if (error.code === 1) return 'Location permission is blocked in your browser. Change this site’s location permission in browser settings, then try again.'
  if (error.code === 2) return 'Your device could not determine a location. Check device location services and try again.'
  if (error.code === 3) return 'The location request timed out. You can try again when your device has a clearer signal.'
  return 'Your location could not be shared. The website remains available without it.'
}

function getPermissionState() {
  if (!navigator.permissions?.query) return Promise.resolve('prompt')
  try {
    return navigator.permissions.query({ name: 'geolocation' }).then((permission) => permission.state).catch(() => 'prompt')
  } catch {
    return Promise.resolve('prompt')
  }
}

function VisitorLocation() {
  const [record, setRecord] = useState(null)
  const [open, setOpen] = useState(!getConsent())
  const [consent, setConsent] = useState(getConsent)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const closeButton = useRef(null)
  const triggerButton = useRef(null)
  const dialog = useRef(null)

  const dismiss = useCallback(() => {
    if (busy) return
    if (consent !== 'granted' && consent !== 'revoked') {
      if (consent !== 'declined' && record) {
        void submitVisitorEvent(record, 'gps_status', {
          location_consent_status: 'declined',
          gps_permission_status: 'not_requested',
        })
      }
      saveConsent('declined')
      setConsent('declined')
    }
    setMessage('')
    setOpen(false)
  }, [busy, consent, record])

  useEffect(() => {
    let active = true
    createVisitorRecord()
      .then(async (visitorRecord) => {
        if (!active || !visitorRecord) return
        let result = await submitVisitorEvent(visitorRecord, 'visit')
        if (!active) return
        const latestConsent = getConsent()
        const consentStatus = latestConsent === 'declined' || latestConsent === 'revoked'
          ? latestConsent
          : latestConsent === 'granted' ? 'consented' : 'not_asked'
        if (consentStatus !== visitorRecord.location_consent_status) {
          result = await submitVisitorEvent(visitorRecord, 'gps_status', {
            location_consent_status: consentStatus,
            gps_permission_status: 'not_requested',
          })
        }
        if (!active) return
        setRecord(visitorRecord)
        if (result.error) setMessage('Visitor analytics is temporarily unavailable. The website remains usable.')
      })
      .catch(() => {
        if (active) setMessage('Visitor analytics could not start. The website remains usable.')
      })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!open) return undefined
    const returnFocusTarget = triggerButton.current
    closeButton.current?.focus()
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        dismiss()
        return
      }
      if (event.key !== 'Tab') return
      const focusable = dialog.current?.querySelectorAll('button:not(:disabled)')
      if (!focusable?.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      returnFocusTarget?.focus()
    }
  }, [dismiss, open])

  async function shareLocation() {
    setMessage('')
    setBusy(true)
    let activeRecord = record
    if (consent === 'revoked') {
      const reconsentResult = await submitVisitorEvent(activeRecord, 'gps_reconsent')
      const nextVersion = reconsentResult.data?.location_consent_version
      if (reconsentResult.error || typeof nextVersion !== 'string'
        || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(nextVersion)) {
        setBusy(false)
        setMessage('Location sharing could not be re-authorized. Reload this page and try again.')
        return
      }
      activeRecord = { ...activeRecord, location_consent_version: nextVersion }
      setRecord(activeRecord)
    } else {
      const consentResult = await recordGpsStatus('not_requested', activeRecord)
      if (consentResult?.error) {
        setBusy(false)
        setMessage('Your location choice could not be verified safely. Please try again later.')
        return
      }
    }
    saveConsent('consented')
    setConsent('consented')

    if (!navigator.geolocation) {
      const statusResult = await recordGpsStatus('unavailable', activeRecord)
      setBusy(false)
      setMessage(statusResult?.error
        ? 'This browser does not support location sharing, and the status could not be saved. The website remains available without it.'
        : 'This browser does not support location sharing. The website remains available without it.')
      return
    }
    const permission = await getPermissionState()
    if (permission === 'denied') {
      const statusResult = await recordGpsStatus('denied', activeRecord)
      setBusy(false)
      setMessage(statusResult?.error
        ? 'Location is blocked in your browser settings, and the status could not be saved. Allow it for this site there, then try again.'
        : 'Location is blocked in your browser settings. Allow it for this site there, then choose Share My Location again.')
      return
    }

    try {
      const challengeResult = await submitVisitorEvent(activeRecord, 'location_challenge')
      if (challengeResult.error || !challengeResult.data?.challenge_token) {
        setBusy(false)
        setMessage('Location sharing could not be authorized safely. Please try again later.')
        return
      }
      navigator.geolocation.getCurrentPosition(async (position) => {
        const gpsCollectedAt = new Date(position.timestamp).toISOString()
        const result = await submitVisitorEvent(activeRecord, 'gps_grant', {
          challenge_token: challengeResult.data.challenge_token,
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          gps_accuracy: position.coords.accuracy,
          gps_collected_at: gpsCollectedAt,
        })
        setBusy(false)
        if (result.error) {
          setMessage('Your location was allowed but could not be saved. You can try again later.')
          return
        }
        saveConsent('granted')
        setConsent('granted')
        setMessage('Location shared for this visit. You can revoke it at any time using this control.')
        setOpen(false)
      }, async (error) => {
        const status = error.code === 1 ? 'denied' : error.code === 2 ? 'unavailable' : 'error'
        const statusResult = await recordGpsStatus(status, activeRecord)
        setBusy(false)
        setMessage(statusResult?.error
          ? `${getLocationError(error)} Its status could not be saved; try again later.`
          : getLocationError(error))
      }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 })
    } catch {
      setBusy(false)
      setMessage('Your browser could not start location sharing. Check its location settings and try again.')
    }
  }

  async function recordGpsStatus(status, targetRecord = record) {
    if (!targetRecord) return null
    return submitVisitorEvent(targetRecord, 'gps_status', {
      location_consent_status: 'consented',
      gps_permission_status: status,
    })
  }

  async function revokeLocation() {
    setBusy(true)
    if (record) {
      const result = await submitVisitorEvent(record, 'revoke', {
      })
      const nextVersion = result.data?.location_consent_version
      if (result.error || typeof nextVersion !== 'string'
        || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(nextVersion)) {
        setBusy(false)
        setMessage('The saved location could not be cleared right now. Please try again.')
        return
      }
      setRecord((current) => ({ ...current, location_consent_version: nextVersion }))
    }
    saveConsent('revoked')
    setConsent('revoked')
    setBusy(false)
    setMessage('Location sharing is revoked. GPS coordinates associated with this browser’s visitor ID were cleared.')
  }

  if (!isSupabaseConfigured) return null

  return (
    <div className="visitor-privacy">
      {message && !open && <p className="visitor-location-message" role="status">{message}<button aria-label="Dismiss message" onClick={() => setMessage('')} type="button"><X size={14} /></button></p>}
      <button className="visitor-privacy-trigger" onClick={() => { setOpen(true); setMessage('') }} ref={triggerButton} type="button">
        <MapPin size={15} /> Location & privacy
      </button>
      {open && (
        <div className="visitor-location-backdrop" onMouseDown={(event) => { if (!busy && event.target === event.currentTarget) dismiss() }} role="presentation">
          <section aria-labelledby="visitor-location-title" aria-modal="true" className="visitor-location-dialog" ref={dialog} role="dialog">
            <button aria-disabled={busy} aria-label="Close location sharing prompt" className="visitor-location-close" onClick={dismiss} ref={closeButton} type="button"><X size={17} /></button>
            <span className="visitor-location-icon"><MapPin size={20} /></span>
            <span className="visitor-location-eyebrow"><ShieldCheck size={14} /> Optional privacy choice</span>
            <h2 id="visitor-location-title">Share Your Location</h2>
            <p>Allow SS Solutions to access your current GPS location to understand where visitors are located. Sharing is optional and linked to a random visitor/session ID stored by this browser; it will not affect website access.</p>
            <p className="visitor-location-note">Your precise coordinates are requested only after you select “Share My Location.” We do not infer exact location from your IP address.</p>
            <p className="visitor-location-note">Visit records are not automatically deleted. An administrator can remove older records under the site's retention policy.</p>
            {message && <p className="visitor-location-feedback" role="status">{message}</p>}
            {consent === 'granted' ? (
              <button className="visitor-location-primary" disabled={busy || !record} onClick={revokeLocation} type="button">{busy ? 'Revoking…' : 'Revoke and clear shared GPS'}</button>
            ) : (
              <button className="visitor-location-primary" disabled={busy || !record} onClick={shareLocation} type="button">{busy ? 'Waiting for browser permission…' : 'Share My Location'}</button>
            )}
            <button className="visitor-location-secondary" disabled={busy} onClick={dismiss} type="button">{consent === 'granted' ? 'Close' : 'Not Now'}</button>
            {consent === 'revoked' && <p className="visitor-location-note">Your previous sharing remains revoked. Selecting “Share My Location” explicitly re-consents for this visit and starts a fresh location request.</p>}
          </section>
        </div>
      )}
    </div>
  )
}

export default VisitorLocation
