import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './figma/index.css'
import FigmaApp from './figma/App'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <FigmaApp />
  </StrictMode>,
)
