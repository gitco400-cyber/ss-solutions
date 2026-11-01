import Reveal from './Reveal.jsx'

function SectionHeading({ eyebrow, title, description }) {
  return (
    <Reveal className="section-heading">
      <span className="eyebrow">{eyebrow}</span>
      <div className="section-heading-row">
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
    </Reveal>
  )
}

export default SectionHeading
