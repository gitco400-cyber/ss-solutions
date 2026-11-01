import { useEffect, useState } from 'react'
import App from './App.jsx'
import AdminApp from './components/AdminApp.jsx'

function Root() {
  const [adminRoute, setAdminRoute] = useState(window.location.hash.startsWith('#/admin'))

  useEffect(() => {
    const handleHashChange = () => setAdminRoute(window.location.hash.startsWith('#/admin'))
    window.addEventListener('hashchange', handleHashChange)
    return () => window.removeEventListener('hashchange', handleHashChange)
  }, [])

  useEffect(() => {
    let theme = 'dark'
    if (!adminRoute) {
      try {
        theme = window.localStorage.getItem('ss-solutions-theme') === 'light' ? 'light' : 'dark'
      } catch {
        theme = 'dark'
      }
    }
    document.documentElement.dataset.theme = theme
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'light' ? '#f4f5f3' : '#080a0b')
  }, [adminRoute])

  return adminRoute ? <AdminApp /> : <App />
}

export default Root
