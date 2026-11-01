import { ArrowUpRight, ArrowUp } from 'lucide-react'
import { siteConfig } from '../config/site.js'

function Footer() {
  return (
    <footer className="site-footer">
      <div className="footer-main section-wrap">
        <div className="footer-brand">
          <a className="brand" href="#home" aria-label={`${siteConfig.name} home`}>
            <img alt="" className="brand-logo" src={`${import.meta.env.BASE_URL}logo.png`} />
            <span className="brand-name">{siteConfig.name}<small>SOFTWARE & DIGITAL</small></span>
          </a>
          <p>{siteConfig.tagline}</p>
        </div>
        <div className="footer-links">
          <div><span className="footer-label">Explore</span><a href="#about">About</a><a href="#services">Services</a><a href="#work">Our work</a></div>
          <div><span className="footer-label">Connect</span><a href="#contact">Contact us <ArrowUpRight size={13} /></a>{siteConfig.whatsappNumber && <a href={`https://wa.me/${siteConfig.whatsappNumber}`} target="_blank" rel="noreferrer">WhatsApp <ArrowUpRight size={13} /></a>}</div>
        </div>
        <a className="back-top" href="#home" aria-label="Back to top"><ArrowUp size={18} /></a>
      </div>
      <div className="footer-bottom section-wrap"><span>© {new Date().getFullYear()} {siteConfig.name}. All rights reserved.</span><span>Thoughtfully built for what’s next.</span></div>
    </footer>
  )
}

export default Footer
