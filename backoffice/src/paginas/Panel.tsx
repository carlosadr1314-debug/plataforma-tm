import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useSesion } from '../lib/sesion'

export default function Panel() {
  const { perfil } = useSesion()
  const [cuenta, setCuenta] = useState<Record<string, number | null>>({})

  useEffect(() => {
    (async () => {
      const tablas = ['pdv', 'sku', 'usuario', 'formulario']
      const r: Record<string, number | null> = {}
      for (const t of tablas) {
        const { count } = await supabase.from(t).select('*', { count: 'exact', head: true })
        r[t] = count
      }
      setCuenta(r)
    })()
  }, [])

  const filas: [string, string][] = [
    ['Puntos de venta', 'pdv'],
    ['SKUs en catálogo', 'sku'],
    ['Usuarios', 'usuario'],
    ['Formularios', 'formulario'],
  ]

  return (
    <>
      <div className="tope">
        <div>
          <h2 className="disp">Panel</h2>
          <p>Sesión de {perfil?.nombre} · {perfil?.perfil}</p>
        </div>
      </div>
      <div className="tabla">
        <table>
          <thead><tr><th>Concepto</th><th>Registros visibles</th></tr></thead>
          <tbody>
            {filas.map(([etiqueta, t]) => (
              <tr key={t}>
                <td>{etiqueta}</td>
                <td className="num">{cuenta[t] ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p style={{ marginTop: 14, fontSize: 13, color: 'var(--tinta-2)' }}>
        Estas cifras ya pasan por las políticas de seguridad: cada perfil ve
        únicamente los registros que le corresponden.
      </p>
    </>
  )
}
