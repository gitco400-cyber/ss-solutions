import { useEffect, useRef, useState } from 'react'
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  Blocks,
  Code2,
  Cpu,
  Gauge,
  Globe2,
  LayoutDashboard,
  LifeBuoy,
  Megaphone,
  PenTool,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import { siteConfig } from './config/site.js'
import Footer from './components/Footer.jsx'
import Header from './components/Header.jsx'
import ProjectCard from './components/ProjectCard.jsx'
import Reveal from './components/Reveal.jsx'
import SectionHeading from './components/SectionHeading.jsx'
import ServiceCard from './components/ServiceCard.jsx'
import SocialLinks from './components/SocialLinks.jsx'
import { getDefaultSocialLinks } from './lib/social.js'
import { fetchPublicSiteData, subscribeToPublicSiteChanges } from './lib/publicSiteSync.js'
import { isSupabaseConfigured, supabase } from './lib/supabase.js'
import './App.css'

const serviceIcons = { Code2, Cpu, Gauge, LayoutDashboard, LifeBuoy, Megaphone, PenTool }

const services = [
  { icon: 'Code2', title: 'Web Development', description: 'Fast, responsive websites and web applications built around the way your business works.' },
  { icon: 'Cpu', title: 'Software Solutions', description: 'Practical, purpose-built software that simplifies tasks and supports your next stage of growth.' },
  { icon: 'LifeBuoy', title: 'IT Support', description: 'Dependable technical guidance to help your systems stay secure, stable, and productive.' },
  { icon: 'Gauge', title: 'PC Optimization', description: 'Windows performance and startup optimization, system cleanup, software and system troubleshooting, gaming performance optimization, and Windows configuration and maintenance.' },
  { icon: 'LayoutDashboard', title: 'UI/UX Design', description: 'Thoughtful digital experiences that make complex products feel clear and natural to use.' },
  { icon: 'PenTool', title: 'Graphic Design', description: 'Cohesive visual assets that help your brand show up with confidence across every touchpoint.' },
  { icon: 'Megaphone', title: 'Digital Marketing', description: 'Digital campaigns and content shaped to connect your business with the right audience.' },
]

const projects = [
  {
    number: '01',
    id: 'orbit-commerce',
    is_demo: true,
    title: 'Orbit Commerce',
    category: 'E-commerce concept',
    description: 'A refined storefront concept focused on product discovery, a calm shopping flow, and a mobile-first experience.',
    type: 'commerce',
    tags: ['Web design', 'Development'],
  },
  {
    number: '02',
    id: 'northstar-insights',
    is_demo: true,
    title: 'Northstar Insights',
    category: 'Analytics dashboard concept',
    description: 'A clear, data-led dashboard concept that turns business metrics into a more approachable daily view.',
    type: 'analytics',
    tags: ['Product design', 'UI/UX'],
  },
  {
    number: '03',
    id: 'forma-studio',
    is_demo: true,
    title: 'Forma Studio',
    category: 'Creative portfolio concept',
    description: 'A distinctive portfolio concept combining expressive art direction with a simple, considered browsing experience.',
    type: 'studio',
    tags: ['Branding', 'Web design'],
  },
]

const defaultContent = {
  hero_heading: 'We Build Digital Experiences That Move Businesses Forward.',
  hero_description: siteConfig.tagline,
  about_heading: 'Good technology should make the next step feel possible.',
  about_paragraph_1: 'SS Solutions brings software development and digital services together to help businesses work smarter, communicate clearly, and keep moving forward.',
  about_paragraph_2: 'Whether you need a new digital experience, a tailored software solution, or reliable technical support, we focus on making the process straightforward and the result genuinely useful.',
  footer_tagline: siteConfig.tagline,
  cta_text: 'Start a conversation',
}

const benefits = [
  { icon: Sparkles, title: 'Built around your goals', description: 'We start by understanding your priorities, then shape a solution that makes sense for your business.' },
  { icon: Blocks, title: 'One connected partner', description: 'From design and development to IT support, bring your digital needs together in one place.' },
  { icon: ShieldCheck, title: 'Quality you can rely on', description: 'We value clear communication, thoughtful details, and dependable work from first step to last.' },
]

const process = [
  { number: '01', title: 'Discover', description: 'We listen, ask the right questions, and get clear on what success looks like for you.' },
  { number: '02', title: 'Plan', description: 'We map out the scope, priorities, and a practical direction before work begins.' },
  { number: '03', title: 'Create', description: 'We design, build, and refine your solution with regular opportunities for feedback.' },
  { number: '04', title: 'Support', description: 'We help you launch with confidence and stay available as your needs evolve.' },
]

function ContactForm({ serviceList }) {
  const [formState, setFormState] = useState('idle')

  async function handleSubmit(event) {
    event.preventDefault()
    const form = event.currentTarget
    const formData = new FormData(form)

    if (formData.get('website')) {
      setFormState('error')
      return
    }

    if (!isSupabaseConfigured || !supabase) {
      setFormState('unconfigured')
      return
    }

    setFormState('submitting')
    try {
      const { error } = await supabase.from('inquiries').insert({
        name: formData.get('name'),
        email: formData.get('email'),
        phone: formData.get('phone') || null,
        service: formData.get('service'),
        message: formData.get('message'),
      })
      if (error) throw error
      form.reset()
      setFormState('success')
    } catch {
      setFormState('error')
    }
  }

  return (
    <form className="contact-form" onSubmit={handleSubmit}>
      <div className="form-grid">
        <label>
          <span>Your name</span>
          <input autoComplete="name" name="name" placeholder="How should we address you?" required />
        </label>
        <label>
          <span>Email address</span>
          <input autoComplete="email" name="email" type="email" placeholder="you@company.com" required />
        </label>
      </div>
      <label>
        <span>Phone number <small>(optional)</small></span>
        <input autoComplete="tel" name="phone" type="tel" pattern="[+()0-9 .-]{7,40}" placeholder="+94 77 598 4372" />
      </label>
      <label>
        <span>What can we help with?</span>
        <select name="service" defaultValue="" required>
          <option value="" disabled>Select a service</option>
          {serviceList.map((service) => <option key={service.title}>{service.title}</option>)}
          <option>Something else</option>
        </select>
      </label>
      <label aria-hidden="true" className="honeypot">
        <span>Leave this field empty</span>
        <input autoComplete="off" name="website" tabIndex="-1" />
      </label>
      <label>
        <span>A little about your project</span>
        <textarea name="message" rows="4" placeholder="Tell us what you have in mind..." required />
      </label>
      <button className="button button-primary form-submit" disabled={formState === 'submitting'} type="submit">
        {formState === 'submitting' ? 'Sending…' : 'Send an enquiry'} <ArrowUpRight size={17} aria-hidden="true" />
      </button>
      <p className={`form-note${formState === 'error' || formState === 'unconfigured' ? ' is-error' : ''}`} aria-live="polite" role={formState === 'error' || formState === 'unconfigured' ? 'alert' : 'status'}>
        {formState === 'success' && 'Thanks — your enquiry was submitted. We’ll be in touch.'}
        {formState === 'error' && 'Your enquiry could not be submitted. Please try again or contact us directly.'}
        {formState === 'unconfigured' && 'Online enquiries are not configured yet. Contact us directly using the links beside this form.'}
        {formState === 'idle' && 'Your details will be used only to respond to your enquiry.'}
      </p>
    </form>
  )
}

function ScrollProgress() {
  const progressRef = useRef(null)

  useEffect(() => {
    function updateProgress() {
      const scrollableHeight = document.documentElement.scrollHeight - window.innerHeight
      const progress = scrollableHeight > 0 ? Math.min(window.scrollY / scrollableHeight, 1) : 0
      progressRef.current?.style.setProperty('--scroll-progress', String(progress))
    }

    updateProgress()
    document.addEventListener('scroll', updateProgress, { passive: true })
    window.addEventListener('resize', updateProgress)

    return () => {
      document.removeEventListener('scroll', updateProgress)
      window.removeEventListener('resize', updateProgress)
    }
  }, [])

  return <div aria-hidden="true" className="scroll-progress" ref={progressRef} />
}

function App() {
  const reduceMotion = useReducedMotion()
  const [publicServices, setPublicServices] = useState(() => services.map((service) => ({
    ...service,
    icon: serviceIcons[service.icon] ?? Code2,
  })))
  const [publicProjects, setPublicProjects] = useState(projects)
  const [socialLinks, setSocialLinks] = useState(() => getDefaultSocialLinks(siteConfig))
  const [content, setContent] = useState(defaultContent)
  const [seo, setSeo] = useState({ title: 'SS Solutions — Software & Digital', description: siteConfig.tagline })
  const [syncInfo, setSyncInfo] = useState({
    loading: isSupabaseConfigured,
    refreshing: false,
    errors: [],
    loaded: { services: false, projects: false, socialLinks: false, content: false, seo: false },
    savedSettings: { content: false, seo: false },
  })

  useEffect(() => {
    let active = true
    let requestInProgress = false
    const queuedSources = new Set()
    let lastRefreshAt = 0

    async function refreshPublicContent(sources = ['services', 'projects', 'socialLinks', 'settings']) {
      if (!isSupabaseConfigured || !supabase || !active) return
      if (requestInProgress) {
        sources.forEach((source) => queuedSources.add(source))
        return
      }

      requestInProgress = true
      const requestedSources = new Set(sources)
      try {
        do {
          const currentSources = [...requestedSources]
          requestedSources.clear()
          setSyncInfo((current) => ({
            ...current,
            loading: !Object.values(current.loaded).some(Boolean),
            refreshing: true,
          }))
          const results = await fetchPublicSiteData(supabase, currentSources)
          if (!active) break

          const serviceResult = results.services
          const projectResult = results.projects
          const socialResult = results.socialLinks
          const settingsResult = results.settings
          const serviceOk = !serviceResult || (serviceResult.status === 'fulfilled' && !serviceResult.value.error)
          const projectOk = !projectResult || (projectResult.status === 'fulfilled' && !projectResult.value.error)
          const socialOk = !socialResult || (socialResult.status === 'fulfilled' && !socialResult.value.error)
          const settingsOk = !settingsResult || (settingsResult.status === 'fulfilled' && !settingsResult.value.error)
          const errors = []

          if (serviceResult && serviceOk) {
            const data = serviceResult.value.data ?? []
            setPublicServices(data.map((service) => ({ ...service, icon: serviceIcons[service.icon] ?? Code2 })))
          } else if (serviceResult) errors.push('services')

          if (projectResult && projectOk) {
            const data = projectResult.value.data ?? []
            setPublicProjects(data.map((project, index) => ({
              ...project,
              number: String(index + 1).padStart(2, '0'),
            })))
          } else if (projectResult) errors.push('projects')

          if (socialResult && socialOk) setSocialLinks(socialResult.value.data ?? [])
          else if (socialResult) errors.push('socialLinks')

          let savedSettings = null
          if (settingsResult && settingsOk) {
            const settings = Object.fromEntries((settingsResult.value.data ?? []).map((setting) => [setting.key, setting.value]))
            savedSettings = {
              content: Object.hasOwn(settings, 'site_content'),
              seo: Object.hasOwn(settings, 'seo'),
            }
            setContent({ ...defaultContent, ...(settings.site_content ?? {}) })
            setSeo({ title: 'SS Solutions — Software & Digital', description: siteConfig.tagline, ...(settings.seo ?? {}) })
          } else if (settingsResult) errors.push('settings')

          setSyncInfo((current) => ({
            loading: false,
            refreshing: false,
            errors: [...current.errors.filter((source) => !currentSources.includes(source)), ...errors],
            loaded: {
              services: current.loaded.services || Boolean(serviceResult && serviceOk),
              projects: current.loaded.projects || Boolean(projectResult && projectOk),
              socialLinks: current.loaded.socialLinks || Boolean(socialResult && socialOk),
              content: current.loaded.content || Boolean(settingsResult && settingsOk),
              seo: current.loaded.seo || Boolean(settingsResult && settingsOk),
            },
            savedSettings: savedSettings ?? current.savedSettings,
          }))
          lastRefreshAt = Date.now()
          queuedSources.forEach((source) => requestedSources.add(source))
          queuedSources.clear()
        } while (requestedSources.size > 0 && active)
      } catch {
        if (active) {
          setSyncInfo((current) => ({ ...current, loading: false, refreshing: false, errors: ['website content'] }))
        }
      } finally {
        requestInProgress = false
      }
    }

    const unsubscribe = subscribeToPublicSiteChanges((source) => {
      void refreshPublicContent(source === 'all' ? ['services', 'projects', 'socialLinks', 'settings'] : [source])
    })
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastRefreshAt > 30_000) {
        void refreshPublicContent()
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    void refreshPublicContent()

    return () => {
      active = false
      unsubscribe()
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [])

  useEffect(() => {
    document.title = seo.title
    document.querySelector('meta[name="description"]')?.setAttribute('content', seo.description)
    document.querySelector('meta[property="og:title"]')?.setAttribute('content', seo.title)
    document.querySelector('meta[property="og:description"]')?.setAttribute('content', seo.description)
  }, [seo])

  const whatsapp = socialLinks.find((link) => link.enabled && link.platform.toLowerCase() === 'whatsapp')
  const previewSections = [
    !syncInfo.loaded.services && 'services',
    !syncInfo.loaded.projects && 'projects',
    !syncInfo.loaded.socialLinks && 'contact links',
    !syncInfo.loaded.content && 'website text',
    syncInfo.loaded.content && !syncInfo.savedSettings.content && 'default website text',
    !syncInfo.loaded.seo && 'SEO settings',
    syncInfo.loaded.seo && !syncInfo.savedSettings.seo && 'default SEO settings',
  ].filter(Boolean)

  return (
    <>
      <a className="skip-link" href="#main-content">Skip to content</a>
      {(syncInfo.loading || syncInfo.refreshing || syncInfo.errors.length > 0 || previewSections.length > 0 || !isSupabaseConfigured) && (
        <div className={`public-sync-notice${syncInfo.errors.length ? ' has-error' : ''}`} role={syncInfo.errors.length ? 'alert' : 'status'}>
          <span>
            {!isSupabaseConfigured
              ? 'Preview mode: showing built-in demo content; saved website content is unavailable.'
              : syncInfo.loading
                ? 'Loading the latest saved website content. Preview content remains available meanwhile.'
                : syncInfo.refreshing
                  ? 'Refreshing saved website content. The currently displayed content remains available.'
                : syncInfo.errors.length
                  ? `Some saved content could not be refreshed (${syncInfo.errors.join(', ')}). Showing the last available content where possible${previewSections.length ? `; built-in preview remains for ${previewSections.join(', ')}` : ''}.`
                  : `Preview content is being used for: ${previewSections.join(', ')}.`}
          </span>
          {isSupabaseConfigured && !syncInfo.loading && (
            <button disabled={syncInfo.refreshing} onClick={() => window.dispatchEvent(new Event('ss-solutions:public-site-sync'))} type="button">
              <RefreshCw size={14} /> {syncInfo.refreshing ? 'Refreshing…' : 'Refresh content'}
            </button>
          )}
        </div>
      )}
      <ScrollProgress />
      <Header />
      <main id="main-content">
        <section className="hero section-wrap" id="home">
          <div className="hero-copy">
            <Reveal>
              <p className="eyebrow"><span className="status-dot" /> Digital ideas, thoughtfully delivered</p>
              <h1>{content.hero_heading}</h1>
              <p className="hero-description">{content.hero_description}</p>
              <div className="hero-actions">
                <a className="button button-primary" href="#contact">{content.cta_text} <ArrowUpRight size={17} aria-hidden="true" /></a>
                <a className="button button-quiet" href="#services">Explore what we do <ArrowDown size={16} aria-hidden="true" /></a>
              </div>
              <div className="hero-note"><span className="note-line" /> A thoughtful partner for your next digital step</div>
            </Reveal>
          </div>
          <motion.div
            className="hero-art"
            initial={reduceMotion ? false : { opacity: 0, scale: 0.96, y: 20 }}
            animate={reduceMotion ? undefined : { opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.8, ease: [0.2, 0.7, 0.2, 1] }}
            aria-hidden="true"
          >
            <div className="art-glow" />
            <div className="orbit orbit-one" />
            <div className="orbit orbit-two" />
            <div className="hero-glass-card">
              <div className="glass-card-top"><span className="window-dots"><i /><i /><i /></span><span>SS / DIGITAL STUDIO</span><span className="card-top-mark">↗</span></div>
              <div className="hero-mark">
                <img src={`${import.meta.env.BASE_URL}logo.png`} alt="" />
              </div>
              <div className="hero-art-title">Ideas into <span>impact.</span></div>
              <div className="hero-art-rule" />
              <div className="hero-art-bottom"><span>DESIGN · BUILD · GROW</span><Globe2 size={16} /></div>
            </div>
            <div className="floating-label label-top"><span className="label-icon teal"><Code2 size={15} /></span><span>Digital solutions</span></div>
            <div className="floating-label label-bottom"><span className="label-icon orange"><Sparkles size={15} /></span><span>Made for what’s next</span></div>
          </motion.div>
          <a className="hero-scroll" href="#about"><span>Scroll to discover</span><ArrowDown size={14} /></a>
        </section>

        <section className="about section-wrap section-space" id="about">
          <div className="about-label"><span className="eyebrow">01 / About us</span></div>
          <Reveal className="about-content">
            <h2>{content.about_heading}</h2>
            <div className="about-detail">
              <p>{content.about_paragraph_1}</p>
              <p>{content.about_paragraph_2}</p>
              <a className="text-link" href="#services">Get to know our services <ArrowRight size={16} /></a>
            </div>
          </Reveal>
        </section>

        <section className="services-section section-wrap section-space" id="services">
          <SectionHeading eyebrow="02 / What we do" title={<>Everything digital, <span className="gradient-text">under one roof.</span></>} description="A flexible range of technology, creative, and support services to meet your business where it is today—and where it wants to go." />
          <div className="services-grid">
            {publicServices.map((service, index) => <ServiceCard key={service.id ?? service.title} {...service} index={index} />)}
          </div>
        </section>

        <section className="work-section section-wrap section-space" id="work">
          <SectionHeading
            eyebrow="03 / Selected concepts"
            title={<>A glimpse of what <span className="gradient-text">we can create.</span></>}
            description={publicProjects.length > 0 && publicProjects.every((project) => project.is_demo)
              ? 'These are demonstration projects created to illustrate our approach and capabilities. They are concepts—not real client projects.'
              : 'Selected SS Solutions projects and demonstration concepts.'}
          />
          <div className="projects-grid">
            {publicProjects.map((project, index) => <ProjectCard key={project.id ?? project.number} {...project} index={index} />)}
          </div>
          {publicProjects.some((project) => project.is_demo) && <p className="demo-disclaimer"><Sparkles size={14} aria-hidden="true" /> Demonstration concepts are not commissioned client work</p>}
        </section>

        <section className="why-section section-wrap section-space" id="why-us">
          <div className="why-intro">
            <span className="eyebrow">04 / Why SS Solutions</span>
            <h2>Big-picture thinking.<br /><span className="gradient-text">People-first delivery.</span></h2>
            <p>Good partnerships are built on more than technology. They’re built on trust, clarity, and a shared sense of what matters.</p>
            <a className="button button-outline" href="#contact">Let’s work together <ArrowUpRight size={16} /></a>
          </div>
          <div className="benefit-list">
            {benefits.map(({ icon: Icon, title, description }, index) => (
              <Reveal className="benefit-row" key={title} delay={index * 0.08}>
                <span className="benefit-icon"><Icon size={20} strokeWidth={1.7} /></span>
                <div><h3>{title}</h3><p>{description}</p></div>
                <span className="benefit-index">0{index + 1}</span>
              </Reveal>
            ))}
          </div>
        </section>

        <section className="process-section section-wrap section-space" id="process">
          <SectionHeading eyebrow="05 / How we work" title={<>A clear path from idea <span className="gradient-text">to done.</span></>} description="A collaborative process with space for good questions, thoughtful decisions, and the details that make the difference." />
          <div className="process-grid">
            {process.map((step, index) => (
              <Reveal className="process-card" key={step.number} delay={index * 0.07}>
                <span className="process-number">{step.number}</span>
                <span className="process-icon" aria-hidden="true">{index === 0 ? <Globe2 /> : index === 1 ? <LayoutDashboard /> : index === 2 ? <Code2 /> : <LifeBuoy />}</span>
                <h3>{step.title}</h3>
                <p>{step.description}</p>
              </Reveal>
            ))}
          </div>
        </section>

        <section className="contact-section section-wrap section-space" id="contact">
          <div className="contact-panel">
            <div className="contact-copy">
              <span className="eyebrow">06 / Get in touch</span>
              <h2>Have something in mind? <span className="gradient-text">Let’s talk.</span></h2>
              <p>Tell us what you’re working on, what’s getting in the way, or where you’d like to go next. We’ll take it from there.</p>
              <div className="contact-promise"><span className="status-dot" /> A real conversation. A thoughtful next step.</div>
              <SocialLinks className="contact-social-links" links={socialLinks} />
            </div>
            <ContactForm serviceList={publicServices} />
          </div>
        </section>
      </main>
      <Footer socialLinks={socialLinks} tagline={content.footer_tagline} />
      {whatsapp && <SocialLinks className="floating-whatsapp" links={[whatsapp]} />}
    </>
  )
}

export default App
