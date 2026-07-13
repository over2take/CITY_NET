import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import SheetPage from './SheetPage.tsx'

// ?sheet=true renders the standalone full-tab character sheet instead of the app
const isSheetTab = new URLSearchParams(window.location.search).has('sheet')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isSheetTab ? <SheetPage /> : <App />}
  </StrictMode>,
)
