import { ArrowUp } from 'lucide-react'
import { siteConfig } from '../config/site.js'
import SocialLinks from './SocialLinks.jsx'

function Footer({ socialLinks, tagline }) {
  return (
    <footer className="site-footer">
      <div className="footer-main section-wrap">
        <div className="footer-brand">
          <a className="brand" href="#home" aria-label={`${siteConfig.name} home`}>
            <img className="brand-logo" src={`${import.meta.env.BASE_URL}logo.png`} alt="SS Solutions Logo" />
            <span className="brand-name">{siteConfig.name}<small>SOFTWARE & DIGITAL</small></span>
          </a>
          <p>{tagline || siteConfig.tagline}</p>
        </div>
        <div className="footer-links">
          <div><span className="footer-label">Explore</span><a href="#about">About</a><a href="#services">Services</a><a href="#work">Our work</a></div>
          <div>
            <span className="footer-label">Connect</span>
            <a href="#contact">Contact us</a>
            <SocialLinks className="footer-social-links" links={socialLinks} />
          </div>
        </div>
        <a className="back-top" href="#home" aria-label="Back to top"><ArrowUp size={18} /></a>
      </div>
      <div className="footer-bottom section-wrap"><span>© {new Date().getFullYear()} {siteConfig.name}. All rights reserved.</span><span>Thoughtfully built for what’s next.</span></div>
    </footer>
  )
}

export default Footer
