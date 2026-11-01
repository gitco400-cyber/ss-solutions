import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  ArrowLeft,
  BriefcaseBusiness,
  CheckCircle2,
  Eye,
  FileText,
  Inbox,
  LayoutDashboard,
  Link2,
  LoaderCircle,
  LogOut,
  Plus,
  Save,
  Search,
  Settings,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react'
import { siteConfig } from '../config/site.js'
import { getSocialHref } from '../lib/social.js'
import { isSupabaseConfigured, supabase } from '../lib/supabase.js'
import './admin.css'

const sections = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'content', label: 'Website Content', icon: FileText },
  { id: 'services', label: 'Services', icon: Settings },
  { id: 'projects', label: 'Projects', icon: BriefcaseBusiness },
  { id: 'inquiries', label: 'Inquiries', icon: Inbox },
  { id: 'social', label: 'Social & Contact', icon: Link2 },
  { id: 'seo', label: 'SEO Settings', icon: Eye },
  { id: 'account', label: 'Account & Security', icon: ShieldCheck },
]

const defaultSiteContent = {
  hero_heading: 'Technology that takes your business further.',
  hero_description: siteConfig.tagline,
  about_heading: 'Good technology should make the next step feel possible.',
  about_paragraph_1: 'SS Solutions brings software development and digital services together to help businesses work smarter, communicate clearly, and keep moving forward.',
  about_paragraph_2: 'Whether you need a new digital experience, a tailored software solution, or reliable technical support, we focus on making the process straightforward and the result genuinely useful.',
  footer_tagline: siteConfig.tagline,
  cta_text: 'Start a conversation',
}

function AdminApp() {
  const [session, setSession] = useState(null)
  const [authChecked, setAuthChecked] = useState(false)
  const [authorized, setAuthorized] = useState(false)
  const [authError, setAuthError] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [section, setSection] = useState('overview')
  const [records, setRecords] = useState({ services: [], projects: [], inquiries: [], socialLinks: [] })
  const [siteContent, setSiteContent] = useState(defaultSiteContent)
  const [seo, setSeo] = useState({ title: 'SS Solutions — Software & Digital', description: siteConfig.tagline })
  const [dataLoading, setDataLoading] = useState(true)
  const [dataError, setDataError] = useState('')
  const [toast, setToast] = useState(null)
  const [saving, setSaving] = useState(false)
  const [editor, setEditor] = useState(null)
  const [socialDraft, setSocialDraft] = useState(null)
  const [inquiryQuery, setInquiryQuery] = useState('')
  const [inquiryStatus, setInquiryStatus] = useState('all')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  const notify = useCallback((message, type = 'success') => {
    setToast({ message, type })
    window.setTimeout(() => setToast(null), 4200)
  }, [])

  const fetchDashboard = useCallback(async () => {
    if (!supabase) return
    setDataLoading(true)
    setDataError('')
    try {
      const [servicesResult, projectsResult, inquiriesResult, socialsResult, settingsResult] = await Promise.all([
        supabase.from('services').select('*').order('sort_order'),
        supabase.from('projects').select('*').order('sort_order'),
        supabase.from('inquiries').select('*').order('created_at', { ascending: false }),
        supabase.from('social_links').select('*').order('sort_order'),
        supabase.from('site_settings').select('*'),
      ])
      const error = [servicesResult, projectsResult, inquiriesResult, socialsResult, settingsResult].find((result) => result.error)?.error
      if (error) throw error

      const settings = Object.fromEntries(settingsResult.data.map((setting) => [setting.key, setting.value]))
      setRecords({
        services: servicesResult.data,
        projects: projectsResult.data,
        inquiries: inquiriesResult.data,
        socialLinks: socialsResult.data,
      })
      setSiteContent((current) => ({ ...current, ...(settings.site_content ?? {}) }))
      setSeo((current) => ({ ...current, ...(settings.seo ?? {}) }))
    } catch {
      setDataError('Dashboard data could not be loaded. Check the Supabase schema and access policies, then try again.')
    } finally {
      setDataLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return undefined

    let active = true
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (active) {
        setSession(nextSession)
        setAuthChecked(true)
        setAuthorized(false)
      }
    })
    supabase.auth.getSession()
      .then(({ data, error }) => {
        if (!active) return
        if (error) setAuthError('Could not restore the administrator session. Please sign in again.')
        setSession(data.session)
        setAuthChecked(true)
      })
      .catch(() => {
        if (active) {
          setAuthError('Could not restore the administrator session. Please sign in again.')
          setAuthChecked(true)
        }
      })

    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!session || !supabase) return undefined

    let active = true
    async function verifyAdministrator() {
      const { data, error } = await supabase
        .from('admin_users')
        .select('user_id')
        .eq('user_id', session.user.id)
        .maybeSingle()

      if (!active) return
      if (error || !data) {
        setAuthorized(false)
        setAuthError(error
          ? 'Administrator access could not be verified. Check the Supabase setup.'
          : 'This account is not authorized to access the dashboard.')
        await supabase.auth.signOut()
        return
      }

      setAuthError('')
      setAuthorized(true)
    }

    verifyAdministrator().catch(() => {
      if (active) setAuthError('Administrator access could not be verified. Please try signing in again.')
    })
    return () => { active = false }
  }, [session])

  useEffect(() => {
    if (authorized) queueMicrotask(fetchDashboard)
  }, [authorized, fetchDashboard])

  async function handleLogin(event) {
    event.preventDefault()
    if (!supabase) return
    setSaving(true)
    setAuthError('')
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) setAuthError('Sign-in failed. Check the email and password for your invited administrator account.')
    } catch {
      setAuthError('Sign-in is unavailable. Check your connection and try again.')
    } finally {
      setSaving(false)
    }
  }

  async function handleLogout() {
    const { error } = await supabase.auth.signOut()
    if (error) {
      notify('Could not sign out. Please try again.', 'error')
      return
    }
    setSession(null)
    setAuthorized(false)
  }

  async function saveSetting(key, value) {
    setSaving(true)
    try {
      const { error } = await supabase.from('site_settings').upsert({ key, value, updated_at: new Date().toISOString() })
      if (error) throw error
      notify('Settings saved.')
      await fetchDashboard()
    } catch {
      notify('The setting could not be saved. Check the database policies and try again.', 'error')
    } finally {
      setSaving(false)
    }
  }

  async function saveRecord(event) {
    event.preventDefault()
    if (!editor) return
    setSaving(true)
    const isProject = editor.kind === 'project'
    const isNew = !editor.record.id
    let payload = isProject
      ? {
          title: editor.record.title.trim(),
          category: editor.record.category.trim(),
          description: editor.record.description.trim(),
          type: editor.record.type || 'studio',
          tags: String(editor.record.tags ?? '').split(',').map((tag) => tag.trim()).filter(Boolean),
          image_url: editor.record.image_url || null,
          is_published: Boolean(editor.record.is_published),
          is_demo: Boolean(editor.record.is_demo),
          sort_order: Number(editor.record.sort_order) || records.projects.length + 1,
        }
      : {
          title: editor.record.title.trim(),
          description: editor.record.description.trim(),
          icon: editor.record.icon || 'Code2',
          is_active: Boolean(editor.record.is_active),
          sort_order: Number(editor.record.sort_order) || records.services.length + 1,
        }

    try {
      if (isProject && editor.file) {
        if (!editor.file.type.startsWith('image/') || editor.file.size > 5 * 1024 * 1024) {
          throw new Error('Choose an image file smaller than 5 MB.')
        }
        const safeName = editor.file.name.replace(/[^a-zA-Z0-9._-]/g, '-')
        const path = `${crypto.randomUUID()}-${safeName}`
        const { error: uploadError } = await supabase.storage.from('project-images').upload(path, editor.file, { contentType: editor.file.type })
        if (uploadError) throw uploadError
        payload = { ...payload, image_url: supabase.storage.from('project-images').getPublicUrl(path).data.publicUrl }
      }

      const query = isNew
        ? supabase.from(isProject ? 'projects' : 'services').insert(payload)
        : supabase.from(isProject ? 'projects' : 'services').update(payload).eq('id', editor.record.id)
      const { error } = await query
      if (error) throw error
      setEditor(null)
      notify(`${isProject ? 'Project' : 'Service'} saved.`)
      await fetchDashboard()
    } catch (error) {
      notify(error.message || 'The record could not be saved.', 'error')
    } finally {
      setSaving(false)
    }
  }

  async function updateRecord(table, id, updates, message = 'Changes saved.') {
    try {
      const { error } = await supabase.from(table).update(updates).eq('id', id)
      if (error) throw error
      notify(message)
      await fetchDashboard()
    } catch {
      notify('The change could not be saved. Please try again.', 'error')
    }
  }

  async function deleteRecord(table, id, name) {
    if (!window.confirm(`Delete "${name}"? This cannot be undone.`)) return
    try {
      const { error } = await supabase.from(table).delete().eq('id', id)
      if (error) throw error
      notify('Record deleted.')
      await fetchDashboard()
    } catch {
      notify('The record could not be deleted. Please try again.', 'error')
    }
  }

  async function saveSocial(event) {
    event.preventDefault()
    if (!socialDraft) return
    const normalizedPlatform = socialDraft.platform.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-')
    const value = socialDraft.value.trim()
    if (socialDraft.enabled && !getSocialHref(normalizedPlatform, value)) {
      notify('Enter a valid phone number, email address, or secure HTTPS URL for this platform.', 'error')
      return
    }

    setSaving(true)
    const payload = {
      label: socialDraft.label.trim(),
      value,
      enabled: Boolean(socialDraft.enabled),
    }
    const query = socialDraft.id
      ? supabase.from('social_links').update(payload).eq('id', socialDraft.id)
      : supabase.from('social_links').insert({
          ...payload,
          platform: normalizedPlatform,
          sort_order: records.socialLinks.length + 1,
        })
    try {
      const { error } = await query
      if (error) throw error
      setSocialDraft(null)
      notify('Social/contact settings saved.')
      await fetchDashboard()
    } catch {
      notify('Social/contact settings could not be saved. Platform names must be unique.', 'error')
    } finally {
      setSaving(false)
    }
  }

  async function updatePassword(event) {
    event.preventDefault()
    if (newPassword.length < 12 || newPassword !== confirmPassword) {
      notify('Use a matching password with at least 12 characters.', 'error')
      return
    }
    setSaving(true)
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword })
      if (error) throw error
      setNewPassword('')
      setConfirmPassword('')
      notify('Password updated.')
    } catch {
      notify('Password could not be updated. Please try again.', 'error')
    } finally {
      setSaving(false)
    }
  }

  const visibleInquiries = useMemo(() => records.inquiries.filter((inquiry) => {
    const query = inquiryQuery.toLowerCase()
    const matchesText = !query || [inquiry.name, inquiry.email, inquiry.service, inquiry.message]
      .some((value) => value?.toLowerCase().includes(query))
    return matchesText && (inquiryStatus === 'all' || inquiry.status === inquiryStatus)
  }), [records.inquiries, inquiryQuery, inquiryStatus])

  if (!isSupabaseConfigured || !supabase) {
    return (
      <main className="admin-setup-screen">
        <section className="admin-setup-card">
          <img alt="SS Solutions Logo" src={`${import.meta.env.BASE_URL}logo.png`} />
          <span className="admin-eyebrow">Admin setup required</span>
          <h1>Connect Supabase to continue</h1>
          <p>The admin dashboard is protected and unavailable until Supabase is configured. Add the public project URL and anon key to your local environment, then apply the database setup instructions.</p>
          <code>VITE_SUPABASE_URL<br />VITE_SUPABASE_ANON_KEY</code>
          <a className="admin-back-link" href={`${import.meta.env.BASE_URL}`}>Return to website <ArrowLeft size={16} /></a>
        </section>
      </main>
    )
  }

  if (!authChecked || (session && !authorized && !authError)) {
    return <main className="admin-loading"><LoaderCircle className="admin-spin" /> Checking administrator access…</main>
  }

  if (!session || !authorized) {
    return (
      <main className="admin-login-screen">
        <form className="admin-login-card" onSubmit={handleLogin}>
          <a className="admin-back-link" href={`${import.meta.env.BASE_URL}`}><ArrowLeft size={16} /> Back to website</a>
          <img alt="SS Solutions Logo" src={`${import.meta.env.BASE_URL}logo.png`} />
          <span className="admin-eyebrow">Secure administrator access</span>
          <h1>Welcome back.</h1>
          <p>Sign in using an administrator account invited in Supabase Auth.</p>
          <label>Email address<input autoComplete="username" onChange={(event) => setEmail(event.target.value)} required type="email" value={email} /></label>
          <label>Password<input autoComplete="current-password" onChange={(event) => setPassword(event.target.value)} required type="password" value={password} /></label>
          {authError && <p className="admin-form-error" role="alert">{authError}</p>}
          <button className="admin-primary-button" disabled={saving} type="submit">{saving ? 'Signing in…' : 'Sign in securely'}</button>
          <p className="admin-login-note">Administrator accounts are provisioned privately. Public registration is disabled.</p>
        </form>
      </main>
    )
  }

  const selectedSection = sections.find((item) => item.id === section)
  const newInquiries = records.inquiries.filter((item) => item.status === 'new').length

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <a className="admin-brand" href={`${import.meta.env.BASE_URL}`}>
          <img alt="" src={`${import.meta.env.BASE_URL}logo.png`} />
          <span>SS Solutions<small>ADMIN CONSOLE</small></span>
        </a>
        <div className="admin-nav-label">Workspace</div>
        <nav aria-label="Admin dashboard">
          {sections.map(({ id, label, icon: Icon }) => (
            <button aria-current={section === id ? 'page' : undefined} className={section === id ? 'is-active' : ''} key={id} onClick={() => setSection(id)} type="button">
              <Icon size={17} />{label}
              {id === 'inquiries' && newInquiries > 0 && <span className="admin-nav-count">{newInquiries}</span>}
            </button>
          ))}
        </nav>
        <div className="admin-sidebar-bottom">
          <span>{session.user.email}</span>
          <button onClick={handleLogout} type="button"><LogOut size={16} /> Sign out</button>
        </div>
      </aside>

      <main className="admin-main">
        <header className="admin-topbar">
          <div><span className="admin-eyebrow">SS Solutions / Admin</span><h1>{selectedSection.label}</h1></div>
          <a className="admin-preview-link" href={`${import.meta.env.BASE_URL}`}><Eye size={16} /> View website</a>
        </header>
        {toast && <div className={`admin-toast ${toast.type}`} role="status">{toast.type === 'error' ? <AlertCircle size={17} /> : <CheckCircle2 size={17} />}{toast.message}</div>}
        {dataError && <div className="admin-alert" role="alert"><AlertCircle size={17} />{dataError}<button onClick={fetchDashboard} type="button">Retry</button></div>}
        {dataLoading ? (
          <div className="admin-loading inline"><LoaderCircle className="admin-spin" /> Loading secure dashboard data…</div>
        ) : (
          <section className="admin-panel">
            {section === 'overview' && <Overview records={records} onNavigate={setSection} />}
            {section === 'content' && <ContentEditor content={siteContent} setContent={setSiteContent} onSave={() => saveSetting('site_content', siteContent)} saving={saving} />}
            {section === 'services' && (
              <RecordManager
                kind="service"
                records={records.services}
                editor={editor}
                setEditor={setEditor}
                saving={saving}
                onSave={saveRecord}
                onUpdate={(record, updates) => updateRecord('services', record.id, updates)}
                onDelete={(record) => deleteRecord('services', record.id, record.title)}
              />
            )}
            {section === 'projects' && (
              <RecordManager
                kind="project"
                records={records.projects}
                editor={editor}
                setEditor={setEditor}
                saving={saving}
                onSave={saveRecord}
                onUpdate={(record, updates) => updateRecord('projects', record.id, updates)}
                onDelete={(record) => deleteRecord('projects', record.id, record.title)}
              />
            )}
            {section === 'inquiries' && (
              <Inquiries
                inquiries={visibleInquiries}
                query={inquiryQuery}
                setQuery={setInquiryQuery}
                status={inquiryStatus}
                setStatus={setInquiryStatus}
                onUpdate={(record, status) => updateRecord('inquiries', record.id, { status }, 'Inquiry status updated.')}
                onDelete={(record) => deleteRecord('inquiries', record.id, record.name)}
              />
            )}
            {section === 'social' && (
              <SocialSettings
                links={records.socialLinks}
                draft={socialDraft}
                setDraft={setSocialDraft}
                saving={saving}
                onSave={saveSocial}
                onDelete={(record) => deleteRecord('social_links', record.id, record.label)}
              />
            )}
            {section === 'seo' && <SeoEditor seo={seo} setSeo={setSeo} onSave={() => saveSetting('seo', seo)} saving={saving} />}
            {section === 'account' && (
              <AccountSecurity
                email={session.user.email}
                newPassword={newPassword}
                setNewPassword={setNewPassword}
                confirmPassword={confirmPassword}
                setConfirmPassword={setConfirmPassword}
                saving={saving}
                onSubmit={updatePassword}
                onLogout={handleLogout}
              />
            )}
          </section>
        )}
      </main>
    </div>
  )
}

function Overview({ records, onNavigate }) {
  const cards = [
    { title: 'Total inquiries', value: records.inquiries.length, icon: Inbox, destination: 'inquiries' },
    { title: 'New inquiries', value: records.inquiries.filter((item) => item.status === 'new').length, icon: AlertCircle, destination: 'inquiries' },
    { title: 'Published projects', value: records.projects.filter((item) => item.is_published).length, icon: BriefcaseBusiness, destination: 'projects' },
    { title: 'Active services', value: records.services.filter((item) => item.is_active).length, icon: Settings, destination: 'services' },
    { title: 'Enabled social links', value: records.socialLinks.filter((item) => item.enabled && getSocialHref(item.platform, item.value)).length, icon: Link2, destination: 'social' },
  ]

  return (
    <>
      <div className="admin-section-intro"><span className="admin-eyebrow">Your business at a glance</span><h2>Dashboard overview</h2><p>Manage your website content, enquiries, services, and public links from one place.</p></div>
      <div className="admin-stat-grid">
        {cards.map(({ title, value, icon: Icon, destination }) => (
          <button className="admin-stat-card" key={title} onClick={() => onNavigate(destination)} type="button">
            <span className="admin-stat-icon"><Icon size={18} /></span><span>{title}</span><strong>{value}</strong>
          </button>
        ))}
      </div>
      <div className="admin-info-card"><ShieldCheck size={19} /><div><strong>Protected by Supabase Auth and Row Level Security</strong><p>Public visitors can only view published content and submit enquiries. Administrator access is controlled by the database allowlist.</p></div></div>
    </>
  )
}

function ContentEditor({ content, setContent, onSave, saving }) {
  const fields = [
    ['hero_heading', 'Hero heading', 'text'],
    ['hero_description', 'Hero description', 'textarea'],
    ['cta_text', 'Primary call-to-action', 'text'],
    ['about_heading', 'About heading', 'text'],
    ['about_paragraph_1', 'About paragraph one', 'textarea'],
    ['about_paragraph_2', 'About paragraph two', 'textarea'],
    ['footer_tagline', 'Footer text', 'textarea'],
  ]
  return (
    <div className="admin-editor-wrap">
      <div className="admin-section-intro"><span className="admin-eyebrow">Public website</span><h2>Website content</h2><p>Changes are saved to Supabase and loaded by the public website.</p></div>
      <form className="admin-form-grid" onSubmit={(event) => { event.preventDefault(); onSave() }}>
        {fields.map(([name, label, type]) => (
          <label className={type === 'textarea' ? 'wide' : ''} key={name}>{label}
            {type === 'textarea'
              ? <textarea onChange={(event) => setContent({ ...content, [name]: event.target.value })} required value={content[name] ?? ''} />
              : <input onChange={(event) => setContent({ ...content, [name]: event.target.value })} required value={content[name] ?? ''} />}
          </label>
        ))}
        <div className="admin-form-actions wide"><button className="admin-primary-button" disabled={saving} type="submit"><Save size={16} /> Save website content</button></div>
      </form>
    </div>
  )
}

function RecordManager({ kind, records, editor, setEditor, saving, onSave, onUpdate, onDelete }) {
  const isProject = kind === 'project'
  const title = isProject ? 'Projects' : 'Services'
  const table = isProject ? 'projects' : 'services'

  function startEdit(record = null) {
    if (!record) {
      setEditor({ kind, record: isProject
        ? { title: '', category: '', description: '', type: 'studio', tags: '', image_url: '', is_published: false, is_demo: false }
        : { title: '', description: '', icon: 'Code2', is_active: true } })
      return
    }
    setEditor({ kind, record: { ...record, tags: Array.isArray(record.tags) ? record.tags.join(', ') : '' } })
  }

  return (
    <div className="admin-editor-wrap">
      <div className="admin-section-intro admin-section-heading">
        <div><span className="admin-eyebrow">Public website</span><h2>{title} management</h2><p>Add, edit, publish, or disable public {title.toLowerCase()}.</p></div>
        <button className="admin-primary-button" onClick={() => startEdit()} type="button"><Plus size={16} /> Add {isProject ? 'project' : 'service'}</button>
      </div>
      {editor?.kind === kind && <RecordForm editor={editor} setEditor={setEditor} isProject={isProject} saving={saving} onSave={onSave} />}
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead><tr><th>Name</th><th>{isProject ? 'Category' : 'Description'}</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>{records.map((record) => (
            <tr key={record.id}>
              <td><strong>{record.title}</strong>{isProject && record.image_url && <a className="admin-inline-link" href={record.image_url} rel="noreferrer" target="_blank">View image</a>}</td>
              <td>{isProject ? record.category : record.description}</td>
              <td><button className={`admin-status-toggle${(isProject ? record.is_published : record.is_active) ? ' enabled' : ''}`} onClick={() => onUpdate(record, { [isProject ? 'is_published' : 'is_active']: !(isProject ? record.is_published : record.is_active) })} type="button">{(isProject ? record.is_published : record.is_active) ? 'Published' : 'Hidden'}</button></td>
              <td className="admin-row-actions"><button aria-label={`Edit ${record.title}`} onClick={() => startEdit(record)} type="button">Edit</button><button aria-label={`Delete ${record.title}`} className="danger" onClick={() => onDelete(record)} type="button"><Trash2 size={15} /></button></td>
            </tr>
          ))}</tbody>
        </table>
        {!records.length && <p className="admin-empty">No {table} yet. Add one to get started.</p>}
      </div>
    </div>
  )
}

function RecordForm({ editor, setEditor, isProject, saving, onSave }) {
  const record = editor.record
  const change = (key, value) => setEditor({ ...editor, record: { ...record, [key]: value } })
  return (
    <form className="admin-record-form" onSubmit={onSave}>
      <div className="admin-record-form-head"><strong>{record.id ? 'Edit' : 'Add'} {isProject ? 'project' : 'service'}</strong><button aria-label="Close editor" onClick={() => setEditor(null)} type="button"><X size={17} /></button></div>
      <div className="admin-form-grid">
        <label>{isProject ? 'Project name' : 'Service name'}<input onChange={(event) => change('title', event.target.value)} required value={record.title} /></label>
        {isProject
          ? <label>Category<input onChange={(event) => change('category', event.target.value)} required value={record.category} /></label>
          : <label>Lucide icon name<input onChange={(event) => change('icon', event.target.value)} placeholder="Code2, Cpu, Gauge…" required value={record.icon} /></label>}
        <label className="wide">Description<textarea onChange={(event) => change('description', event.target.value)} required value={record.description} /></label>
        {isProject ? (
          <>
            <label>Visual type<select onChange={(event) => change('type', event.target.value)} value={record.type}><option value="commerce">Commerce</option><option value="analytics">Analytics</option><option value="studio">Studio</option></select></label>
            <label>Tags, separated by commas<input onChange={(event) => change('tags', event.target.value)} value={record.tags} /></label>
            <label className="wide">Project image<input accept="image/*" onChange={(event) => setEditor({ ...editor, file: event.target.files?.[0] ?? null })} type="file" /><small>Optional image upload, up to 5 MB. Supabase Storage must be set up.</small></label>
            <label className="admin-checkbox"><input checked={Boolean(record.is_published)} onChange={(event) => change('is_published', event.target.checked)} type="checkbox" /> Published on website</label>
            <label className="admin-checkbox"><input checked={Boolean(record.is_demo)} onChange={(event) => change('is_demo', event.target.checked)} type="checkbox" /> Demonstration concept</label>
          </>
        ) : <label className="admin-checkbox"><input checked={Boolean(record.is_active)} onChange={(event) => change('is_active', event.target.checked)} type="checkbox" /> Active on website</label>}
      </div>
      <div className="admin-form-actions"><button className="admin-primary-button" disabled={saving} type="submit"><Save size={16} /> {saving ? 'Saving…' : 'Save changes'}</button><button className="admin-secondary-button" onClick={() => setEditor(null)} type="button">Cancel</button></div>
    </form>
  )
}

function Inquiries({ inquiries, query, setQuery, status, setStatus, onUpdate, onDelete }) {
  return (
    <div className="admin-editor-wrap">
      <div className="admin-section-intro"><span className="admin-eyebrow">Customer messages</span><h2>Inquiries</h2><p>Only authorized administrators can view these submissions.</p></div>
      <div className="admin-inquiry-filters">
        <label className="admin-search"><Search size={16} /><input aria-label="Search inquiries" onChange={(event) => setQuery(event.target.value)} placeholder="Search name, email, service…" value={query} /></label>
        <select aria-label="Filter by status" onChange={(event) => setStatus(event.target.value)} value={status}><option value="all">All statuses</option><option value="new">New</option><option value="read">Read</option><option value="completed">Completed</option></select>
      </div>
      <div className="admin-inquiry-list">
        {inquiries.map((inquiry) => (
          <article className="admin-inquiry-card" key={inquiry.id}>
            <div className="admin-inquiry-head"><div><h3>{inquiry.name}</h3><span>{new Date(inquiry.created_at).toLocaleString()}</span></div><select aria-label={`Status for ${inquiry.name}`} onChange={(event) => onUpdate(inquiry, event.target.value)} value={inquiry.status}><option value="new">New</option><option value="read">Read</option><option value="completed">Completed</option></select></div>
            <div className="admin-inquiry-details"><a href={`mailto:${inquiry.email}`}>{inquiry.email}</a>{inquiry.phone && <a href={`tel:${inquiry.phone}`}>{inquiry.phone}</a>}<span>{inquiry.service}</span></div>
            <p>{inquiry.message}</p>
            <button className="admin-text-danger" onClick={() => onDelete(inquiry)} type="button"><Trash2 size={14} /> Delete inquiry</button>
          </article>
        ))}
        {!inquiries.length && <p className="admin-empty">No inquiries match this filter.</p>}
      </div>
    </div>
  )
}

function SocialSettings({ links, draft, setDraft, saving, onSave, onDelete }) {
  function addSocial() {
    setDraft({ label: '', platform: '', value: '', enabled: false })
  }

  return (
    <div className="admin-editor-wrap">
      <div className="admin-section-intro admin-section-heading">
        <div><span className="admin-eyebrow">Public links and details</span><h2>Social Media & Contact Settings</h2><p>Only enabled, valid destinations appear on the public website. Platform identifiers must be unique.</p></div>
        <button className="admin-primary-button" onClick={addSocial} type="button"><Plus size={16} /> Add platform</button>
      </div>
      {draft && (
        <form className="admin-record-form" onSubmit={onSave}>
          <div className="admin-record-form-head"><strong>{draft.id ? 'Edit' : 'Add'} platform</strong><button aria-label="Close editor" onClick={() => setDraft(null)} type="button"><X size={17} /></button></div>
          <div className="admin-form-grid">
            <label>Display name<input onChange={(event) => setDraft({ ...draft, label: event.target.value })} placeholder="WhatsApp, Email, Discord…" required value={draft.label} /></label>
            <label>Platform key<input disabled={Boolean(draft.id)} onChange={(event) => setDraft({ ...draft, platform: event.target.value })} placeholder="whatsapp, facebook…" required value={draft.platform} /></label>
            <label className="wide">Phone, email, or URL<input onChange={(event) => setDraft({ ...draft, value: event.target.value })} required={draft.enabled} value={draft.value} /></label>
            <label className="admin-checkbox"><input checked={Boolean(draft.enabled)} onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} type="checkbox" /> Enabled</label>
          </div>
          {draft.value && getSocialHref(draft.platform, draft.value) && <a className="admin-inline-link" href={getSocialHref(draft.platform, draft.value)} rel="noreferrer" target="_blank">Preview destination</a>}
          <div className="admin-form-actions"><button className="admin-primary-button" disabled={saving} type="submit"><Save size={16} /> Save platform</button><button className="admin-secondary-button" onClick={() => setDraft(null)} type="button">Cancel</button></div>
        </form>
      )}
      <div className="admin-social-list">
        {links.map((link) => {
          const href = getSocialHref(link.platform, link.value)
          return (
            <article className="admin-social-card" key={link.id}>
              <div><span className="admin-social-icon"><Link2 size={17} /></span><div><strong>{link.label}</strong><small>{link.platform}</small></div></div>
              <p>{link.value || 'No destination set'}{href && <a aria-label={`Preview ${link.label} destination`} href={href} rel="noreferrer" target="_blank"><Eye size={15} /></a>}</p>
              <span className={`admin-pill${link.enabled && href ? ' enabled' : ''}`}>{link.enabled && href ? 'Enabled' : 'Disabled'}</span>
              <div className="admin-row-actions"><button onClick={() => setDraft({ ...link })} type="button">Edit</button><button aria-label={`Delete ${link.label}`} className="danger" onClick={() => onDelete(link)} type="button"><Trash2 size={15} /></button></div>
            </article>
          )
        })}
        {!links.length && <p className="admin-empty">No social or contact links have been added.</p>}
      </div>
    </div>
  )
}

function SeoEditor({ seo, setSeo, onSave, saving }) {
  return (
    <div className="admin-editor-wrap">
      <div className="admin-section-intro"><span className="admin-eyebrow">Search and sharing</span><h2>SEO settings</h2><p>Update the page title and meta description used by the public website.</p></div>
      <form className="admin-form-grid" onSubmit={(event) => { event.preventDefault(); onSave() }}>
        <label className="wide">Page title<input maxLength="70" onChange={(event) => setSeo({ ...seo, title: event.target.value })} required value={seo.title} /></label>
        <label className="wide">Meta description<textarea maxLength="200" onChange={(event) => setSeo({ ...seo, description: event.target.value })} required value={seo.description} /></label>
        <div className="admin-form-actions wide"><button className="admin-primary-button" disabled={saving} type="submit"><Save size={16} /> Save SEO settings</button></div>
      </form>
    </div>
  )
}

function AccountSecurity({ email, newPassword, setNewPassword, confirmPassword, setConfirmPassword, saving, onSubmit, onLogout }) {
  return (
    <div className="admin-editor-wrap">
      <div className="admin-section-intro"><span className="admin-eyebrow">Account protection</span><h2>Account & Security</h2><p>Administrator access is invite-only; use a strong unique password.</p></div>
      <div className="admin-info-card"><ShieldCheck size={19} /><div><strong>Signed in as {email}</strong><p>Database permissions are enforced by Supabase Row Level Security in addition to this dashboard route.</p></div></div>
      <form className="admin-form-grid admin-password-form" onSubmit={onSubmit}>
        <label>New password<input autoComplete="new-password" minLength={12} onChange={(event) => setNewPassword(event.target.value)} required type="password" value={newPassword} /></label>
        <label>Confirm new password<input autoComplete="new-password" minLength={12} onChange={(event) => setConfirmPassword(event.target.value)} required type="password" value={confirmPassword} /></label>
        <div className="admin-form-actions wide"><button className="admin-primary-button" disabled={saving} type="submit"><Save size={16} /> Update password</button><button className="admin-secondary-button" onClick={onLogout} type="button"><LogOut size={16} /> Sign out</button></div>
      </form>
    </div>
  )
}

export default AdminApp
