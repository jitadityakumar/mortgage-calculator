import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { AdminPage } from './components/AdminPage.tsx'

// No router dependency — this is the app's only second route. nginx's SPA
// fallback (try_files $uri /index.html) and Vite dev/preview both serve
// index.html for any path, including /admin/, so the trailing-slash strip
// below is the only routing logic needed.
const isAdminRoute = window.location.pathname.replace(/\/$/, '') === '/admin'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isAdminRoute ? <AdminPage /> : <App />}
  </StrictMode>,
)
