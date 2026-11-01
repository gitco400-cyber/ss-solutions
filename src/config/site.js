export const siteConfig = {
  name: 'SS Solutions',
  tagline: 'Your Partner in Software Development and Digital Transformation.',
  whatsappNumber: import.meta.env.VITE_WHATSAPP_NUMBER?.replace(/\D/g, '') ?? '',
  contactEmail: import.meta.env.VITE_CONTACT_EMAIL ?? '',
}
