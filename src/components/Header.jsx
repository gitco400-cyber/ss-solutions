import { useState } from 'react'
import { ArrowUpRight, Menu, X } from 'lucide-react'
import { siteConfig } from '../config/site.js'

const navItems = [
  { href: '#about', label: 'About' },
  { href: '#services', label: 'Services' },
  { href: '#work', label: 'Our work' },
  { href: '#process', label: 'Process' },
]

function Header() {
  const [menuOpen, setMenuOpen] = useState(false)

  function closeMenu() {
    setMenuOpen(false)
  }

  return (
    <header className="site-header">
      <div className="nav-shell">
        <a aria-label={`${siteConfig.name} home`} className="brand" href="#home" onClick={closeMenu}>
          <img alt="" className="brand-logo" src={`${import.meta.env.BASE_URL}logo.png`} />
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
          {navItems.map((item) => <a href={item.href} key={item.href} onClick={closeMenu}>{item.label}</a>)}
          <a className="nav-contact" href="#contact" onClick={closeMenu}>Let’s talk <ArrowUpRight size={14} /></a>
        </nav>
      </div>
    </header>
  )
}

export default Header
