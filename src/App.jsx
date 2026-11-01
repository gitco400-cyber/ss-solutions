import { useState } from 'react'
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  Blocks,
  Code2,
  Cpu,
  Globe2,
  LayoutDashboard,
  LifeBuoy,
  Megaphone,
  PenTool,
  ShieldCheck,
  Sparkles,
  Wrench,
} from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import { siteConfig } from './config/site.js'
import Footer from './components/Footer.jsx'
import Header from './components/Header.jsx'
import ProjectCard from './components/ProjectCard.jsx'
import Reveal from './components/Reveal.jsx'
import SectionHeading from './components/SectionHeading.jsx'
import ServiceCard from './components/ServiceCard.jsx'
import './App.css'

const services = [
  { icon: Code2, title: 'Web Development', description: 'Fast, responsive websites and web applications built around the way your business works.' },
  { icon: Cpu, title: 'Software Solutions', description: 'Practical, purpose-built software that simplifies tasks and supports your next stage of growth.' },
  { icon: LifeBuoy, title: 'IT Support', description: 'Dependable technical guidance to help your systems stay secure, stable, and productive.' },
  { icon: LayoutDashboard, title: 'UI/UX Design', description: 'Thoughtful digital experiences that make complex products feel clear and natural to use.' },
  { icon: PenTool, title: 'Graphic Design', description: 'Cohesive visual assets that help your brand show up with confidence across every touchpoint.' },
  { icon: Wrench, title: 'Computer Repair', description: 'Careful diagnostics and repair support to get your computers back to doing their best work.' },
  { icon: Megaphone, title: 'Digital Marketing', description: 'Digital campaigns and content shaped to connect your business with the right audience.' },
]

const projects = [
  {
    number: '01',
    title: 'Orbit Commerce',
    category: 'E-commerce concept',
    description: 'A refined storefront concept focused on product discovery, a calm shopping flow, and a mobile-first experience.',
    type: 'commerce',
    tags: ['Web design', 'Development'],
  },
  {
    number: '02',
    title: 'Northstar Insights',
    category: 'Analytics dashboard concept',
    description: 'A clear, data-led dashboard concept that turns business metrics into a more approachable daily view.',
    type: 'analytics',
    tags: ['Product design', 'UI/UX'],
  },
  {
    number: '03',
    title: 'Forma Studio',
    category: 'Creative portfolio concept',
    description: 'A distinctive portfolio concept combining expressive art direction with a simple, considered browsing experience.',
    type: 'studio',
    tags: ['Branding', 'Web design'],
  },
]

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

function ContactForm() {
  const [formState, setFormState] = useState('idle')

  function handleSubmit(event) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    const message = [
      `Hello ${siteConfig.name},`,
      '',
      `I'm ${formData.get('name')}.`,
      `My email: ${formData.get('email')}`,
      `I'm interested in: ${formData.get('service')}`,
      '',
      formData.get('message'),
    ].join('\n')

    if (siteConfig.whatsappNumber) {
      window.open(`https://wa.me/${siteConfig.whatsappNumber}?text=${encodeURIComponent(message)}`, '_blank', 'noopener,noreferrer')
      setFormState('opened')
      return
    }

    if (siteConfig.contactEmail) {
      window.location.href = `mailto:${siteConfig.contactEmail}?subject=${encodeURIComponent(`Website enquiry from ${formData.get('name')}`)}&body=${encodeURIComponent(message)}`
      setFormState('opened')
      return
    }

    setFormState('unconfigured')
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
        <span>What can we help with?</span>
        <select name="service" defaultValue="" required>
          <option value="" disabled>Select a service</option>
          {services.map((service) => <option key={service.title}>{service.title}</option>)}
          <option>Something else</option>
        </select>
      </label>
      <label>
        <span>A little about your project</span>
        <textarea name="message" rows="4" placeholder="Tell us what you have in mind..." required />
      </label>
      <button className="button button-primary form-submit" type="submit">
        Send an enquiry <ArrowUpRight size={17} aria-hidden="true" />
      </button>
      <p className="form-note" aria-live="polite">
        {formState === 'opened' && 'Your message is ready in your selected contact app. Complete the send there to reach us.'}
        {formState === 'unconfigured' && 'Contact is not configured yet. Add VITE_WHATSAPP_NUMBER or VITE_CONTACT_EMAIL to the app environment to enable sending.'}
        {formState === 'idle' && 'Your details will be used only to respond to your enquiry.'}
      </p>
    </form>
  )
}

function App() {
  const reduceMotion = useReducedMotion()

  return (
    <>
      <a className="skip-link" href="#main-content">Skip to content</a>
      <Header />
      <main id="main-content">
        <section className="hero section-wrap" id="home">
          <div className="hero-copy">
            <Reveal>
              <p className="eyebrow"><span className="status-dot" /> Digital ideas, thoughtfully delivered</p>
              <h1>Technology that takes your business <span className="gradient-text">further.</span></h1>
              <p className="hero-description">{siteConfig.tagline}</p>
              <div className="hero-actions">
                <a className="button button-primary" href="#contact">Start a conversation <ArrowUpRight size={17} aria-hidden="true" /></a>
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
                <img src="/logo.png" alt="" />
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
            <h2>Good technology should make the next step <span className="muted-text">feel possible.</span></h2>
            <div className="about-detail">
              <p>SS Solutions brings software development and digital services together to help businesses work smarter, communicate clearly, and keep moving forward.</p>
              <p>Whether you need a new digital experience, a tailored software solution, or reliable technical support, we focus on making the process straightforward and the result genuinely useful.</p>
              <a className="text-link" href="#services">Get to know our services <ArrowRight size={16} /></a>
            </div>
          </Reveal>
        </section>

        <section className="services-section section-wrap section-space" id="services">
          <SectionHeading eyebrow="02 / What we do" title={<>Everything digital, <span className="gradient-text">under one roof.</span></>} description="A flexible range of technology, creative, and support services to meet your business where it is today—and where it wants to go." />
          <div className="services-grid">
            {services.map((service, index) => <ServiceCard key={service.title} {...service} index={index} />)}
          </div>
        </section>

        <section className="work-section section-wrap section-space" id="work">
          <SectionHeading
            eyebrow="03 / Selected concepts"
            title={<>A glimpse of what <span className="gradient-text">we can create.</span></>}
            description="These are demonstration projects created to illustrate our approach and capabilities. They are concepts—not real client projects."
          />
          <div className="projects-grid">
            {projects.map((project, index) => <ProjectCard key={project.number} {...project} index={index} />)}
          </div>
          <p className="demo-disclaimer"><Sparkles size={14} aria-hidden="true" /> Demonstration concepts only · Not commissioned client work</p>
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
              {siteConfig.whatsappNumber && (
                <a className="whatsapp-link" href={`https://wa.me/${siteConfig.whatsappNumber}`} target="_blank" rel="noreferrer">
                  Prefer WhatsApp? Start a chat <ArrowUpRight size={15} />
                </a>
              )}
            </div>
            <ContactForm />
          </div>
        </section>
      </main>
      <Footer />
    </>
  )
}

export default App
