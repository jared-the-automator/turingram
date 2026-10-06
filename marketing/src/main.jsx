import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter, Routes, Route } from 'react-router'
import './index.css'
import App from './App.jsx'
import GuideClaude from './pages/GuideClaude.jsx'
import GuideGPT from './pages/GuideGPT.jsx'
import GuideGemini from './pages/GuideGemini.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <HashRouter>
      <Routes>
        <Route path="/" element={<App />} />
        <Route path="/guide/claude" element={<GuideClaude />} />
        <Route path="/guide/chatgpt" element={<GuideGPT />} />
        <Route path="/guide/gemini" element={<GuideGemini />} />
      </Routes>
    </HashRouter>
  </StrictMode>,
)
