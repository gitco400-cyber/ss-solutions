import { ArrowUpRight } from 'lucide-react'
import Reveal from './Reveal.jsx'

function ServiceCard({ icon: Icon, title, description, index }) {
  return (
    <Reveal className="service-card" delay={index * 0.045}>
      <span className="service-icon"><Icon size={21} strokeWidth={1.7} /></span>
      <span className="service-number">0{index + 1}</span>
      <h3>{title}</h3>
      <p>{description}</p>
      <a aria-label={`Ask us about ${title}`} className="service-arrow" href="#contact"><ArrowUpRight size={17} /></a>
    </Reveal>
  )
}

export default ServiceCard
