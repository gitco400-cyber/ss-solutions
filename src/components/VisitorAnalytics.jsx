import { useEffect, useMemo, useState } from 'react'
import {
  ChartNoAxesCombined,
  ChevronLeft,
  ChevronRight,
  Monitor,
  RefreshCw,
  Search,
  Smartphone,
  Tablet,
  Trash2,
  Users,
  X,
} from 'lucide-react'
import { supabase } from '../lib/supabase.js'
import './VisitorAnalytics.css'

const pageSize = 25
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const safePathSearch = /^[a-z0-9/_-]{1,80}$/i

function getDateRange(from, to) {
  if (from && to && from > to) throw new Error('The start date must be on or before the end date.')
  const start = from ? new Date(`${from}T00:00:00`).toISOString() : null
  const endDate = to ? new Date(`${to}T00:00:00`) : null
  if (endDate) endDate.setDate(endDate.getDate() + 1)
  return { start, end: endDate?.toISOString() ?? null }
}

function formatDate(value) {
  if (!value) return 'Unknown'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Unknown' : date.toLocaleString()
}

function formatValue(value) {
  return value === null || value === undefined || value === '' ? 'Unknown' : String(value)
}

function formatDeviceType(value) {
  const deviceType = formatValue(value)
  return deviceType === 'Unknown' ? deviceType : `${deviceType[0].toUpperCase()}${deviceType.slice(1)}`
}

function formatDimensions(width, height) {
  return Number.isInteger(width) && Number.isInteger(height) ? `${width} × ${height}` : 'Unknown'
}

function formatVersion(name, version) {
  return `${formatValue(name)}${version ? ` ${version}` : ''}`
}

async function fetchAnalyticsData({ fromDate, toDate, search, deviceType, page }) {
  const { start, end } = getDateRange(fromDate, toDate)
  const normalizedSearch = search.trim()
  if (normalizedSearch && !uuidPattern.test(normalizedSearch) && !safePathSearch.test(normalizedSearch)) {
    throw new Error('Search by visitor/session UUID or a simple page path (letters, numbers, /, _ and -).')
  }

  let rowsQuery = supabase.from('visitor_analytics').select('*', { count: 'exact' })
    .order('visited_at', { ascending: false })
    .range(page * pageSize, (page + 1) * pageSize - 1)
  if (start) rowsQuery = rowsQuery.gte('visited_at', start)
  if (end) rowsQuery = rowsQuery.lt('visited_at', end)
  if (deviceType !== 'all') rowsQuery = rowsQuery.eq('device_type', deviceType)
  if (normalizedSearch) {
    rowsQuery = uuidPattern.test(normalizedSearch)
      ? rowsQuery.or(`visitor_id.eq.${normalizedSearch},session_id.eq.${normalizedSearch}`)
      : rowsQuery.ilike('page_path', `%${normalizedSearch}%`)
  }

  const [rowsResult, summaryResult] = await Promise.all([
    rowsQuery,
    supabase.rpc('get_visitor_analytics_summary', { p_from: start, p_to: end }),
  ])
  if (rowsResult.error) throw rowsResult.error
  if (summaryResult.error) throw summaryResult.error
  return {
    records: rowsResult.data ?? [],
    total: rowsResult.count ?? 0,
    summary: Array.isArray(summaryResult.data) ? summaryResult.data[0] ?? null : summaryResult.data,
  }
}

function VisitorAnalytics() {
  const [records, setRecords] = useState([])
  const [summary, setSummary] = useState(null)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [search, setSearch] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [deviceType, setDeviceType] = useState('all')
  const [refreshVersion, setRefreshVersion] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState(null)
  const [retentionDays, setRetentionDays] = useState('180')
  const [retentionBusy, setRetentionBusy] = useState(false)
  const [notice, setNotice] = useState('')

  useEffect(() => {
    let active = true
    fetchAnalyticsData({ fromDate, toDate, search, deviceType, page })
      .then((result) => {
        if (!active) return
        setRecords(result.records)
        setTotal(result.total)
        setSummary(result.summary)
        setError('')
        setLoading(false)
      })
      .catch((loadError) => {
        if (!active) return
        setError(loadError.message || 'Visitor analytics could not be loaded. Check the migration and administrator permissions, then retry.')
        setRecords([])
        setSummary(null)
        setTotal(0)
        setLoading(false)
      })
    return () => { active = false }
  }, [deviceType, fromDate, page, refreshVersion, search, toDate])

  useEffect(() => {
    if (!selected) return undefined
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setSelected(null)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selected])

  const stats = useMemo(() => [
    { title: 'Total visits', value: summary?.total_visits, icon: ChartNoAxesCombined },
    { title: 'Unique visitors', value: summary?.unique_visitors, icon: Users },
    { title: 'Mobile visitors', value: summary?.mobile_visitors, icon: Smartphone },
    { title: 'Desktop visitors', value: summary?.desktop_visitors, icon: Monitor },
    { title: 'Tablet visitors', value: summary?.tablet_visitors, icon: Tablet },
  ], [summary])

  async function purgeExpiredRecords() {
    const days = Number(retentionDays)
    if (!Number.isInteger(days) || days < 1 || days > 3650) {
      setError('Choose a retention period from 1 to 3650 days.')
      return
    }
    if (!window.confirm(`Permanently delete visitor analytics records older than ${days} days? This cannot be undone.`)) return

    setRetentionBusy(true)
    setNotice('')
    try {
      const { data, error: purgeError } = await supabase.rpc('purge_visitor_analytics_older_than', { p_older_than_days: days })
      if (purgeError) throw purgeError
      setNotice(`${Number(data) || 0} expired record(s) deleted.`)
      setLoading(true)
      setPage(0)
      setRefreshVersion((version) => version + 1)
    } catch {
      setError('Expired records could not be deleted. Confirm the migration is applied and your administrator account is authorized.')
    } finally {
      setRetentionBusy(false)
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  return (
    <div className="admin-analytics">
      <div className="admin-section-intro">
        <span className="admin-eyebrow">Device-only visitor activity</span>
        <h2>Visitor Analytics</h2>
        <p>Page visits, device details, and random visitor/session IDs. No precise location or IP addresses are stored. Statistics reflect the selected date range.</p>
      </div>

      <div className="admin-analytics-stat-grid">
        {stats.map(({ title, value, icon: Icon }) => (
          <article className="admin-analytics-stat" key={title}>
            <span className="admin-stat-icon"><Icon size={17} /></span>
            <span>{title}</span>
            <strong>{value === undefined ? '—' : Number(value).toLocaleString()}</strong>
          </article>
        ))}
      </div>

      <div className="admin-analytics-retention">
        <div><strong>Data retention</strong><p>No records are deleted automatically. Choose an age and run a one-time deletion when appropriate.</p></div>
        <label>Older than
          <input aria-label="Delete records older than days" max="3650" min="1" onChange={(event) => setRetentionDays(event.target.value)} type="number" value={retentionDays} /> days
        </label>
        <button className="admin-secondary-button" disabled={retentionBusy} onClick={purgeExpiredRecords} type="button"><Trash2 size={15} />{retentionBusy ? 'Deleting…' : 'Delete expired records'}</button>
      </div>

      {notice && <p className="admin-analytics-notice" role="status">{notice}</p>}
      <div className="admin-analytics-toolbar">
        <label className="admin-analytics-search"><span className="sr-only">Search visitor, session, or page path</span><Search size={16} /><input onChange={(event) => { setLoading(true); setSearch(event.target.value); setPage(0) }} placeholder="Search ID or page path" value={search} /></label>
        <label>Date from<input aria-label="Date from" onChange={(event) => { setLoading(true); setFromDate(event.target.value); setPage(0) }} type="date" value={fromDate} /></label>
        <label>Date to<input aria-label="Date to" onChange={(event) => { setLoading(true); setToDate(event.target.value); setPage(0) }} type="date" value={toDate} /></label>
        <label>Device<select onChange={(event) => { setLoading(true); setDeviceType(event.target.value); setPage(0) }} value={deviceType}><option value="all">All devices</option><option value="mobile">Mobile</option><option value="desktop">Desktop</option><option value="tablet">Tablet</option><option value="unknown">Unknown</option></select></label>
        <button aria-label="Refresh analytics" className="admin-secondary-button" disabled={loading} onClick={() => { setLoading(true); setRefreshVersion((version) => version + 1) }} type="button"><RefreshCw size={15} />Refresh</button>
      </div>

      {error && <div className="admin-analytics-error" role="alert">{error}</div>}
      <div className="admin-table-wrap admin-analytics-table-wrap">
        <table className="admin-table admin-analytics-table">
          <thead><tr><th>Visit date & time</th><th>Visitor ID</th><th>Session ID</th><th>Device</th><th>Operating system</th><th>Browser</th><th>Screen</th><th>Viewport</th><th>Page</th></tr></thead>
          <tbody>
            {!loading && records.map((record) => (
              <tr key={record.id}>
                <td>{formatDate(record.visited_at)}</td>
                <td><button className="admin-analytics-id" onClick={() => setSelected(record)} type="button">{record.visitor_id}</button></td>
                <td>{record.session_id}</td>
                <td>{formatDeviceType(record.device_type)}</td>
                <td>{formatVersion(record.operating_system, record.os_version)}</td>
                <td>{formatVersion(record.browser, record.browser_version)}</td>
                <td>{formatDimensions(record.screen_width, record.screen_height)}</td>
                <td>{formatDimensions(record.viewport_width, record.viewport_height)}</td>
                <td>{formatValue(record.page_path)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {loading && <p className="admin-empty">Loading visitor records…</p>}
        {!loading && !error && !records.length && <p className="admin-empty">No visitor records match these filters.</p>}
      </div>
      <div className="admin-analytics-pagination">
        <span>{total ? `${page * pageSize + 1}–${Math.min((page + 1) * pageSize, total)} of ${total} visits` : '0 visits'} · {pageSize} per page</span>
        <div>
          <button aria-label="Previous page" className="admin-secondary-button" disabled={loading || page === 0} onClick={() => { setLoading(true); setPage((current) => Math.max(0, current - 1)) }} type="button"><ChevronLeft size={15} /> Previous</button>
          <span>Page {page + 1} of {totalPages}</span>
          <button aria-label="Next page" className="admin-secondary-button" disabled={loading || page + 1 >= totalPages} onClick={() => { setLoading(true); setPage((current) => current + 1) }} type="button">Next <ChevronRight size={15} /></button>
        </div>
      </div>

      {selected && <VisitorDetails record={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}

function VisitorDetails({ record, onClose }) {
  return (
    <div className="admin-analytics-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }} role="presentation">
      <section aria-labelledby="visitor-details-title" aria-modal="true" className="admin-analytics-modal" role="dialog">
        <header><div><span className="admin-eyebrow">Visitor record</span><h2 id="visitor-details-title">Visit details</h2></div><button aria-label="Close visit details" className="admin-analytics-close" onClick={onClose} type="button"><X size={18} /></button></header>
        <div className="admin-analytics-details-grid">
          <Detail label="Random visitor ID" value={record.visitor_id} />
          <Detail label="Session ID" value={record.session_id} />
          <Detail label="Visit date/time" value={formatDate(record.visited_at)} />
          <Detail label="First visit" value={formatDate(record.first_visited_at)} />
          <Detail label="Page path" value={record.page_path} />
          <Detail label="Device category" value={formatDeviceType(record.device_type)} />
          <Detail label="Device brand" value={record.device_brand} />
          <Detail label="Device model" value={record.device_model} />
          <Detail label="Operating system" value={formatVersion(record.operating_system, record.os_version)} />
          <Detail label="Browser" value={formatVersion(record.browser, record.browser_version)} />
          <Detail label="Screen resolution" value={formatDimensions(record.screen_width, record.screen_height)} />
          <Detail label="Viewport size" value={formatDimensions(record.viewport_width, record.viewport_height)} />
          <Detail label="Device pixel ratio" value={record.device_pixel_ratio} />
          <Detail label="Browser language" value={record.language} />
        </div>
      </section>
    </div>
  )
}

function Detail({ label, value }) {
  return <div><span>{label}</span><strong>{formatValue(value)}</strong></div>
}

export default VisitorAnalytics
