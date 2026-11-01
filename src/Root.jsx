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

  return adminRoute ? <AdminApp /> : <App />
}

export default Root
