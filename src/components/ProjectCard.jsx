import { ArrowUpRight } from 'lucide-react'
import Reveal from './Reveal.jsx'

function ProjectVisual({ type }) {
  if (type === 'commerce') {
    return (
      <div className="project-visual commerce-visual" aria-hidden="true">
        <div className="mock-browser"><span /><span /><span /><i>ORBIT GOODS</i><b>MENU BAG (0)</b></div>
        <div className="commerce-layout"><div><small>OBJECTS FOR EVERY DAY</small><strong>Find your<br />everyday.</strong><span>Thoughtful design, made to last.</span><i>EXPLORE COLLECTION ↗</i></div><div className="product-shape"><span /><b>O.</b></div></div>
      </div>
    )
  }
  if (type === 'analytics') {
    return (
      <div className="project-visual analytics-visual" aria-hidden="true">
        <div className="dashboard-side"><b>N.</b><span>⌂</span><span>▤</span><span>◷</span><span>⚙</span></div>
        <div className="dashboard-main"><div className="dashboard-head"><span>Good morning, Alex</span><i>MON, 18 NOV</i></div><small>OVERVIEW</small><strong>Your business at a glance.</strong><div className="dashboard-stats"><span>REVENUE<b>$24,680</b><i>+12.8%</i></span><span>ORDERS<b>1,284</b><i>+8.2%</i></span></div><div className="chart-area"><span /><span /><span /><span /><span /><span /><span /><i /></div></div>
      </div>
    )
  }
  return (
    <div className="project-visual studio-visual" aria-hidden="true">
      <div className="studio-top"><b>FORMA®</b><span>SELECTED WORK ABOUT ↗</span></div>
      <div className="studio-title">MAKE<br /><em>ROOM</em><br />TO CREATE.</div>
      <div className="studio-art"><span>F</span><i /></div>
      <div className="studio-bottom"><span>INDEPENDENT CREATIVE STUDIO</span><span>SCROLL TO EXPLORE ↓</span></div>
    </div>
  )
}

function ProjectCard({ number, title, category, description, type, tags = [], image_url: imageUrl, is_demo: isDemo = true, index }) {
  return (
    <Reveal className="project-card" delay={index * 0.08}>
      {imageUrl
        ? <div className="project-visual project-image"><img alt={`${title} project preview`} loading="lazy" src={imageUrl} /></div>
        : <ProjectVisual type={type} />}
      <div className="project-meta"><span>{number} / {category}</span>{isDemo && <span className="demo-tag">DEMO CONCEPT</span>}</div>
      <div className="project-info">
        <div><h3>{title}</h3><p>{description}</p></div>
        <span aria-hidden="true" className="project-link"><ArrowUpRight size={17} /></span>
      </div>
      <div className="project-tags">{tags.map((tag) => <span key={tag}>{tag}</span>)}</div>
    </Reveal>
  )
}

export default ProjectCard
