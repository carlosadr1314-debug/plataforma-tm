import { useEffect } from 'react'

// =====================================================================
// La evidencia en grande
//
// Una miniatura de 90 px sirve para saber que hay foto. No sirve para
// ver si el precio del anaquel es el pactado, si la cenefa esta
// puesta, o si quien volvio de comer esta de verdad en la tienda, que
// es para lo que se piden.
//
// Encima va de que es. Sin eso, ocho fotos de un anaquel son ocho
// fotos de un anaquel.
// =====================================================================

export type FotoVista = {
  url?: string | null
  bytes: number | null
  lat: number | null
  lng: number | null
  tomada_en: string | null
  /** De que es: la pregunta del formulario, o lo que la etiqueta diga. */
  titulo: string
}

const hhmm = (t: string | null | undefined) =>
  t ? new Date(t).toLocaleTimeString('es-MX',
        { hour: '2-digit', minute: '2-digit', hour12: false }) : '—'

const kb = (n: number | null) => (n ? Math.round(n / 1024) + ' KB' : '—')

export default function FotoAmpliada({ foto, onCerrar }: {
  foto: FotoVista; onCerrar: () => void
}) {
  useEffect(() => {
    const alTeclear = (e: KeyboardEvent) => { if (e.key === 'Escape') onCerrar() }
    window.addEventListener('keydown', alTeclear)
    // El fondo no se desplaza mientras esto esta encima.
    const antes = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', alTeclear)
      document.body.style.overflow = antes
    }
  }, [onCerrar])

  const coords = foto.lat != null && foto.lng != null
    ? `${foto.lat.toFixed(5)}, ${foto.lng.toFixed(5)}`
    : null

  return (
    <div className="lupa" role="dialog" aria-modal="true" aria-label={foto.titulo}
         onClick={onCerrar}>
      <div className="lupa-caja" onClick={e => e.stopPropagation()}>
        <div className="lupa-cabeza">
          <div>
            <h4>{foto.titulo}</h4>
            <p>
              {hhmm(foto.tomada_en)} · {kb(foto.bytes)}
              {coords && <> · <span className="cifras">{coords}</span></>}
            </p>
          </div>
          <button type="button" className="lupa-x" onClick={onCerrar}
                  aria-label="Cerrar la foto">×</button>
        </div>
        <img src={foto.url ?? ''} alt={foto.titulo} />
      </div>
    </div>
  )
}

/** Como se nombra cada tipo de evidencia en la pantalla. */
export const TITULO_EVIDENCIA: Record<string, string> = {
  inicio_visita: 'Llegada al punto de venta',
  regreso_comida: 'Regreso de la comida',
  check_in_seguridad: 'Check-in de seguridad',
}
