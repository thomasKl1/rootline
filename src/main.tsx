import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { captureInviteFromUrl } from './lib/sharing'

// Un lien d'invitation (?invite=…) est gardé de côté avant tout, pour survivre à la connexion.
captureInviteFromUrl()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
