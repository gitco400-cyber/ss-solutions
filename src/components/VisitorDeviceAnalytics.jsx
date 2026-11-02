import { useCallback, useEffect, useState } from 'react'
import { Activity, RefreshCw } from 'lucide-react'
import { supabase } from '../lib/supabase.js'

const pageSize = 20
const emptySummary = {
  total_visits: 0,
  unique_visitors: 0,
  device_types: { Desktop: 0, Mobile: 0, Tablet: 0, Unknown: 0 },
  operating_systems: [],
  browsers: [],
  screen_categories: [],
}

function percentage(value, total) {
  if (!total) return 0
  return Math.round((Number(value) / total) * 100)
}

function Distribution({ title, rows, total }) {
  return (
    <section className="visitor-analytics-card">
      <h3>{title}</h3>
      {rows.length === 0
        ? <p className="visitor-analytics-muted">No recorded visits yet.</p>
        : <ul className="visitor-analytics-distribution">
          {rows.map(({ label, count }) => (
            <li key={label}>
              <div><span>{label}</span><strong>{count} · {percentage(count, total)}%</strong></div>
              <span aria-hidden="true" className="visitor-analytics-bar"><i style={{ width: `${percentage(count, total)}%` }} /></span>
            </li>
          ))}
        </ul>}
    </section>
  )
}

function VisitorDeviceAnalytics() {
  const [summary, setSummary] = useState(emptySummary)
  const [visits, setVisits] = useState([])
  const [totalRecords, setTotalRecords] = useState(0)
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const loadData = useCallback(async () => {
    if (!supabase) {
      setError('Supabase is not configured.')
      setLoading(false)
      return
    }

    setLoading(true)
    setError('')
    const start = page * pageSize
    try {
      const [summaryResult, visitsResult] = await Promise.all([
        supabase.rpc('get_visitor_analytics_summary'),
        supabase
          .from('visitor_analytics')
          .select('visit_id, visited_at, device_type, operating_system, browser, browser_version, screen_category', { count: 'exact' })
          .order('visited_at', { ascending: false })
          .order('visit_id', { ascending: false })
          .range(start, start + pageSize - 1),
      ])
      if (summaryResult.error) throw summaryResult.error
      if (visitsResult.error) throw visitsResult.error
      setSummary({ ...emptySummary, ...summaryResult.data })
      setVisits(visitsResult.data ?? [])
      setTotalRecords(visitsResult.count ?? 0)
    } catch {
      setError('Visitor analytics could not be loaded. Verify the migration and administrator access, then retry.')
      setVisits([])
      setTotalRecords(0)
    } finally {
      setLoading(false)
    }
  }, [page])

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadData() }, 0)
    return () => window.clearTimeout(timer)
  }, [loadData])

  const total = Number(summary.total_visits) || 0
  const deviceCounts = summary.device_types ?? emptySummary.device_types
  const deviceCards = [
    ['Recorded visits', total],
    ['Desktop visits', Number(deviceCounts.Desktop) || 0],
    ['Mobile visits', Number(deviceCounts.Mobile) || 0],
    ['Tablet visits', Number(deviceCounts.Tablet) || 0],
    ['Unknown device', Number(deviceCounts.Unknown) || 0],
    ['Unique visitors', Number(summary.unique_visitors) || 0],
  ]
  const deviceRows = Object.entries(deviceCounts).map(([label, count]) => ({ label, count: Number(count) || 0 }))
  const maxPage = Math.max(0, Math.ceil(totalRecords / pageSize) - 1)

  return (
    <div className="visitor-analytics">
      <div className="admin-section-heading visitor-analytics-heading">
        <div className="admin-section-intro">
          <span className="admin-eyebrow">Privacy-conscious reporting · last 90 days</span>
          <h2>Visitor device analytics</h2>
          <p>Visits are consent-based and deduplicated by visit ID. Unique visitors are random browser IDs, not identified people.</p>
        </div>
        <button className="admin-secondary-button" disabled={loading} onClick={loadData} type="button">
          <RefreshCw size={15} /> Refresh
        </button>
      </div>

      {error && <div className="admin-alert" role="alert"><Activity size={16} />{error}</div>}
      {loading && <div className="admin-loading inline"><Activity className="admin-spin" /> Loading visitor analytics…</div>}
      {!loading && !error && total === 0 && (
        <div className="visitor-analytics-empty">
          <Activity size={23} />
          <strong>No visitor analytics yet</strong>
          <p>Consent-based visits will appear here after the analytics function and migration are configured.</p>
        </div>
      )}
      {!loading && !error && total > 0 && (
        <>
          <div className="visitor-analytics-stats">
            {deviceCards.map(([label, value]) => <article className="visitor-analytics-stat" key={label}><span>{label}</span><strong>{value.toLocaleString()}</strong></article>)}
          </div>
          <div className="visitor-analytics-distributions">
            <Distribution rows={summary.operating_systems ?? []} title="Operating systems" total={total} />
            <Distribution rows={summary.browsers ?? []} title="Browsers" total={total} />
            <Distribution rows={deviceRows} title="Device types" total={total} />
            <Distribution rows={summary.screen_categories ?? []} title="Screen categories" total={total} />
          </div>
          <section className="visitor-analytics-recent">
            <div className="admin-section-heading">
              <div><h3>Recent device activity</h3><p>Recorded visits, newest first.</p></div>
              <span>{totalRecords.toLocaleString()} visits</span>
            </div>
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead><tr><th>Date and time</th><th>Device</th><th>Operating system</th><th>Browser</th><th>Version</th><th>Screen</th></tr></thead>
                <tbody>
                  {visits.map((visit) => (
                    <tr key={visit.visit_id}>
                      <td>{new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(visit.visited_at))}</td>
                      <td>{visit.device_type}</td>
                      <td>{visit.operating_system}</td>
                      <td>{visit.browser}</td>
                      <td>{visit.browser_version || 'Unknown'}</td>
                      <td>{visit.screen_category}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="visitor-analytics-pagination">
              <button className="admin-secondary-button" disabled={page === 0 || loading} onClick={() => setPage((current) => current - 1)} type="button">Previous</button>
              <span>Page {page + 1} of {maxPage + 1}</span>
              <button className="admin-secondary-button" disabled={page >= maxPage || loading} onClick={() => setPage((current) => current + 1)} type="button">Next</button>
            </div>
          </section>
        </>
      )}
    </div>
  )
}

export default VisitorDeviceAnalytics
