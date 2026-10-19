// Iconos en SVG. Nada de emoji como icono.
const base = {
  width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none',
  stroke: 'currentColor', strokeWidth: 2,
  strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
  'aria-hidden': true,
}

export const IcoTienda = () => (
  <svg {...base}><path d="M3 21V9l9-6 9 6v12" /><path d="M9 21v-7h6v7" /></svg>
)
export const IcoCaja = () => (
  <svg {...base}><path d="m21 8-9-5-9 5v8l9 5 9-5z" /><path d="m3 8 9 5 9-5M12 13v8" /></svg>
)
export const IcoGente = () => (
  <svg {...base}><circle cx="9" cy="8" r="3.5" /><path d="M2 21c0-3.6 3.1-5.5 7-5.5s7 1.9 7 5.5" /></svg>
)
export const IcoPanel = () => (
  <svg {...base}><path d="M3 3v18h18" /><path d="m7 14 4-4 3 3 5-6" /></svg>
)

export const IcoForm = () => (
  <svg {...base}><path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7z" />
    <path d="M14 2v5h5M9 13h6M9 17h4" /></svg>
)

export const IcoRuta = () => (
  <svg {...base}><rect x="3" y="5" width="18" height="16" rx="2" />
    <path d="M8 3v4M16 3v4M3 11h18M8 15h3" /></svg>
)
