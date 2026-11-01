import { Link2, Mail, MessageCircle, MessageSquareText } from 'lucide-react'

const platformIcons = {
  whatsapp: MessageCircle,
  email: Mail,
  discord: MessageSquareText,
}

export function getPlatformIcon(platform) {
  return platformIcons[platform.toLowerCase()] ?? Link2
}

export function getSocialHref(platform, value) {
  const normalizedPlatform = platform.toLowerCase()
  const trimmedValue = value.trim()

  if (normalizedPlatform === 'whatsapp') {
    const internationalNumber = trimmedValue.replace(/[()\s.-]/g, '')
    return /^\+?[1-9]\d{7,14}$/.test(internationalNumber)
      ? `https://wa.me/${internationalNumber.replace(/^\+/, '')}`
      : null
  }

  if (normalizedPlatform === 'email') {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedValue)
      ? `mailto:${trimmedValue}`
      : null
  }

  if (normalizedPlatform === 'discord') {
    try {
      const url = new URL(trimmedValue)
      if (url.protocol !== 'https:') return null
      const isUserProfile = ['discord.com', 'www.discord.com'].includes(url.hostname)
        && /^\/users\/\d+\/?$/.test(url.pathname)
      const isInvite = url.hostname === 'discord.gg'
        ? /^\/[a-zA-Z0-9-]+\/?$/.test(url.pathname)
        : ['discord.com', 'www.discord.com'].includes(url.hostname)
          && /^\/invite\/[a-zA-Z0-9-]+\/?$/.test(url.pathname)
      return isUserProfile || isInvite ? url.href : null
    } catch {
      return null
    }
  }

  try {
    const url = new URL(trimmedValue)
    return url.protocol === 'https:' ? url.href : null
  } catch {
    return null
  }
}

export function getDefaultSocialLinks(siteConfig) {
  return [
    { id: 'whatsapp', platform: 'whatsapp', label: 'WhatsApp', value: siteConfig.whatsappNumber, enabled: true },
    { id: 'email', platform: 'email', label: 'Email', value: siteConfig.contactEmail, enabled: true },
    { id: 'discord', platform: 'discord', label: 'Discord', value: siteConfig.discordUrl, enabled: true },
  ]
}
