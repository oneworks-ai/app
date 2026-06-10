import 'antd/dist/reset.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'

import { AdminApp } from './app/AdminApp'
import { AdminThemeProvider } from './app/AdminThemeProvider'

const root = document.querySelector('#root')
const adminBase = window.location.pathname === '/admin' || window.location.pathname.startsWith('/admin/')
  ? '/admin'
  : '/'

if (root != null) {
  createRoot(root).render(
    <StrictMode>
      <AdminThemeProvider>
        <BrowserRouter basename={adminBase}>
          <AdminApp />
        </BrowserRouter>
      </AdminThemeProvider>
    </StrictMode>
  )
}
