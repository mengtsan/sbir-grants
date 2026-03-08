import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import axios from 'axios'

// Global Axios configuration
axios.defaults.withCredentials = true;

axios.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response && error.response.status === 401) {
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

const rootElement = document.getElementById('root')
const marketingRoot = document.getElementById('marketing-root')
const isStaticHomepage = window.location.pathname === '/'

if (isStaticHomepage) {
  if (rootElement) {
    rootElement.innerHTML = ''
  }
} else if (rootElement) {
  if (marketingRoot) {
    marketingRoot.style.display = 'none'
  }
  createRoot(rootElement).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}
