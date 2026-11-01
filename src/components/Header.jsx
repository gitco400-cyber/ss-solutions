import { useEffect, useRef, useState } from 'react'
import { ArrowUpRight, BriefcaseBusiness, Grid2X2, Menu, Moon, Sun, UserRound, Workflow, X } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { siteConfig } from '../config/site.js'

const navItems = [
  { href: '#about', label: 'About', Icon: UserRound },
  { href: '#services', label: 'Services', Icon: Grid2X2 },
  { href: '#work', label: 'Our Work', Icon: BriefcaseBusiness },
  { href: '#process', label: 'Process', Icon: Workflow },
]

function Header() {
  const [menuOpen, setMenuOpen] = useState(false)
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme === 'light' ? 'light' : 'dark')
  const [activeSection, setActiveSection] = useState('#about')
  const [logoPopup, setLogoPopup] = useState(null)
  const brandRef = useRef(null)
  const closeButtonRef = useRef(null)
  const popupTimerRef = useRef(null)
  const hoverTimerRef = useRef(null)
  const restoreFocusRef = useRef(false)
  const reduceMotion = useReducedMotion()

  useEffect(() => {
    const sections = navItems
      .map(({ href }) => document.querySelector(href))
      .filter(Boolean)

    const observer = new IntersectionObserver((entries) => {
      const current = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
      if (current) setActiveSection(`#${current.target.id}`)
    }, { rootMargin: '-25% 0px -65% 0px', threshold: 0 })

    sections.forEach((section) => observer.observe(section))
    return () => observer.disconnect()
  }, [])

  useEffect(() => () => {
    window.clearTimeout(popupTimerRef.current)
    window.clearTimeout(hoverTimerRef.current)
  }, [])

  useEffect(() => {
    if (!logoPopup) return undefined

    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        event.preventDefault()
        dismissLogoPopup()
      }

      if (event.key === 'Tab' && restoreFocusRef.current && closeButtonRef.current) {
        event.preventDefault()
        closeButtonRef.current.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    if (restoreFocusRef.current) closeButtonRef.current?.focus({ preventScroll: true })
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [logoPopup])

  useEffect(() => {
    if (logoPopup || !restoreFocusRef.current) return
    restoreFocusRef.current = false
    brandRef.current?.focus({ preventScroll: true })
  }, [logoPopup])

  function getLogoOrigin() {
    const rect = brandRef.current?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0 }
    return {
      x: rect.left + rect.width / 2 - window.innerWidth / 2,
      y: rect.top + rect.height / 2 - window.innerHeight / 2,
    }
  }

  function openLogoPopup({ autoClose = false, focusClose = false } = {}) {
    window.clearTimeout(hoverTimerRef.current)
    if (logoPopup) {
      if (autoClose) {
        window.clearTimeout(popupTimerRef.current)
        popupTimerRef.current = window.setTimeout(() => {
          popupTimerRef.current = null
          dismissLogoPopup()
        }, 3000)
      }
      return
    }
    restoreFocusRef.current = focusClose
    setLogoPopup({ origin: getLogoOrigin() })
    closeMenu()
    if (autoClose) {
      window.clearTimeout(popupTimerRef.current)
      popupTimerRef.current = window.setTimeout(() => {
        popupTimerRef.current = null
        dismissLogoPopup()
      }, 3000)
    }
  }

  function dismissLogoPopup() {
    window.clearTimeout(popupTimerRef.current)
    window.clearTimeout(hoverTimerRef.current)
    setLogoPopup(null)
  }

  function handleBrandClick(event) {
    const isTouch = window.matchMedia('(hover: none), (pointer: coarse)').matches
    if (isTouch || event.detail === 0) {
      event.preventDefault()
      openLogoPopup({ autoClose: true, focusClose: true })
      return
    }
    closeMenu()
    dismissLogoPopup()
  }

  function handleBrandPointerEnter(event) {
    if (event.pointerType === 'mouse') openLogoPopup()
  }

  function scheduleHoverDismiss() {
    window.clearTimeout(hoverTimerRef.current)
    hoverTimerRef.current = window.setTimeout(dismissLogoPopup, 600)
  }

  function keepHoverPopupOpen() {
    window.clearTimeout(hoverTimerRef.current)
  }

  function closeMenu() {
    setMenuOpen(false)
  }

  function toggleTheme() {
    const nextTheme = theme === 'dark' ? 'light' : 'dark'
    document.documentElement.dataset.theme = nextTheme
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', nextTheme === 'light' ? '#f4f5f3' : '#080a0b')
    setTheme(nextTheme)
    try {
      window.localStorage.setItem('ss-solutions-theme', nextTheme)
    } catch {
      // The selected theme remains active until the page is reloaded.
    }
  }

  return (
    <header className="site-header">
      <div className="nav-shell">
        <a
          aria-label={`${siteConfig.name} home; hover or activate to enlarge the logo`}
          className="brand"
          href="#home"
          onClick={handleBrandClick}
          onPointerEnter={handleBrandPointerEnter}
          onPointerLeave={scheduleHoverDismiss}
          ref={brandRef}
        >
          <img className="brand-logo" src={`${import.meta.env.BASE_URL}logo.png`} alt="SS Solutions Logo" />
          <span className="brand-name">{siteConfig.name}<small>SOFTWARE & DIGITAL</small></span>
        </a>
        <button
          aria-expanded={menuOpen}
          aria-label={menuOpen ? 'Close navigation menu' : 'Open navigation menu'}
          className="menu-toggle"
          onClick={() => setMenuOpen((open) => !open)}
          type="button"
        >
          {menuOpen ? <X size={21} /> : <Menu size={21} />}
        </button>
        <nav aria-label="Main navigation" className={`main-nav${menuOpen ? ' is-open' : ''}`}>
          {navItems.map(({ href, label, Icon }) => (
            <a
              aria-current={activeSection === href ? 'location' : undefined}
              className="nav-link"
              href={href}
              key={href}
              onClick={() => {
                setActiveSection(href)
                closeMenu()
              }}
            >
              <Icon aria-hidden="true" className="nav-link-icon" size={15} strokeWidth={1.8} />
              <span>{label}</span>
            </a>
          ))}
          <a className="nav-contact" href="#contact" onClick={closeMenu}>Let’s talk <ArrowUpRight size={14} /></a>
          <button
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode; ${theme} mode is active`}
            aria-pressed={theme === 'light'}
            className="theme-toggle"
            onClick={toggleTheme}
            type="button"
          >
            {theme === 'dark' ? <Sun aria-hidden="true" size={16} /> : <Moon aria-hidden="true" size={16} />}
            <span>{theme === 'dark' ? 'Dark mode' : 'Light mode'}</span>
          </button>
        </nav>
      </div>
      <AnimatePresence>
        {logoPopup && (
          <motion.div
            animate={{ opacity: 1 }}
            aria-label="SS Solutions logo preview"
            className="logo-popup-overlay"
            exit={{ opacity: 0 }}
            initial={{ opacity: 0 }}
            aria-modal="true"
            onClick={(event) => {
              if (event.target === event.currentTarget) dismissLogoPopup()
            }}
            role="dialog"
            transition={{ duration: reduceMotion ? 0 : 0.22, ease: 'easeOut' }}
          >
            <motion.div
              animate={{ opacity: 1, scale: 1, x: 0, y: 0 }}
              className="logo-popup-card"
              exit={{
                opacity: 0,
                scale: reduceMotion ? 1 : 0.72,
                x: reduceMotion ? 0 : logoPopup.origin.x,
                y: reduceMotion ? 0 : logoPopup.origin.y,
              }}
              initial={{
                opacity: 0,
                scale: reduceMotion ? 1 : 0.42,
                x: reduceMotion ? 0 : logoPopup.origin.x,
                y: reduceMotion ? 0 : logoPopup.origin.y,
              }}
              onMouseEnter={keepHoverPopupOpen}
              onMouseLeave={scheduleHoverDismiss}
              transition={{
                duration: reduceMotion ? 0 : 0.48,
                ease: [0.2, 0.7, 0.2, 1],
                opacity: { duration: reduceMotion ? 0 : 0.24 },
              }}
            >
              <button
                aria-label="Close logo preview"
                className="logo-popup-close"
                onClick={dismissLogoPopup}
                ref={closeButtonRef}
                type="button"
              >
                <X aria-hidden="true" size={18} />
              </button>
              <img alt="SS Solutions company logo" className="logo-popup-image" src={`${import.meta.env.BASE_URL}logo.png`} />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  )
}

export default Header
