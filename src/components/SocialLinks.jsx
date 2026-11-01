import { getPlatformIcon, getSocialHref } from '../lib/social.js'

function SocialLinks({ links, className = '' }) {
  const validLinks = links.filter((link) => link.enabled && getSocialHref(link.platform, link.value))

  if (!validLinks.length) return null

  return (
    <div className={`social-links ${className}`.trim()}>
      {validLinks.map((link) => {
        const Icon = getPlatformIcon(link.platform)
        const href = getSocialHref(link.platform, link.value)
        const isExternal = href.startsWith('https:')

        return (
          <a
            aria-label={link.label}
            href={href}
            key={link.id ?? link.platform}
            rel={isExternal ? 'noreferrer' : undefined}
            target={isExternal ? '_blank' : undefined}
            title={link.label}
          >
            <Icon aria-hidden="true" size={17} />
            <span>{link.label}</span>
          </a>
        )
      })}
    </div>
  )
}

export default SocialLinks
