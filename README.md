# SS Solutions

A responsive company website built with React, Vite, Tailwind CSS v4, Motion, and Lucide React.

## Run locally

```sh
npm install
npm run dev
```

Create a `.env.local` file in this directory to enable contact actions:

```env
VITE_WHATSAPP_NUMBER=countrycodeandnumber
VITE_CONTACT_EMAIL=your-contact-email
```

Set at least one contact destination. WhatsApp is used when both are configured. The number should include the country code and contain digits only; the app strips other characters.

The three portfolio items on the page are demonstration concepts, not real client projects. Replace the content in `src/App.jsx` and the contact values in `.env.local` with approved business information.

## Build

```sh
npm run build
```
