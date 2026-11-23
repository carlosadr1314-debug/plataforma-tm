import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './estilos.css'
import App from './App.tsx'
import Tropiezo from './componentes/Tropiezo'

createRoot(document.getElementById('root')!).render(
  <StrictMode><Tropiezo><App /></Tropiezo></StrictMode>
)
