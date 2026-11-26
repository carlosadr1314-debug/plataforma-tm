import { useId, useState } from 'react'

// =====================================================================
// Graficas
//
// Dibujadas a mano en SVG. No se agrega una libreria de graficas: el
// bundle ya pesa 746 kB y lo que hace falta aqui son dos formas.
//
// Reglas que se siguen a proposito, no por gusto:
//
//   · Una sola serie por grafica, un solo color. Nada de pintar cada
//     barra de un tono segun su valor: eso vuelve a codificar el
//     largo de la barra en el color y gasta el unico canal libre en
//     algo que la barra ya dice.
//   · Linea de 2 px, relleno al 10%, rejilla de un paso sobre el
//     fondo. El dato es lo unico que puede ser fuerte.
//   · Se etiqueta el extremo, no cada punto. Un numero sobre cada
//     punto es ruido y nadie lo lee.
//   · El texto nunca lleva el color del dato: la marca de color va al
//     lado, el texto en tinta.
//   · Las dos llevan capa de hover. Una grafica en pantalla que no
//     responde al puntero esta a medias.
// =====================================================================

const AZUL = '#16324F'
const BORDE = '#DFDCD6'
const TINTA2 = '#6B6560'

/**
 * valor en null = no habia nada que medir ese dia. No es lo mismo que
 * cero: un dia sin ruta programada dibujado como 0% se lee como "no
 * cumplieron", y es el error mas facil de cometer en una grafica de
 * cumplimiento. La linea se corta ahi.
 */
export type Punto = { etiqueta: string; valor: number | null; detalle?: string }

// ---------------------------------------------------------------------
// Linea en el tiempo
// ---------------------------------------------------------------------

export function GraficaLinea({ datos, alto = 200, sufijo = '', titulo }: {
  datos: Punto[]; alto?: number; sufijo?: string; titulo: string
}) {
  const id = useId()
  const [sobre, setSobre] = useState<number | null>(null)

  if (datos.length === 0) {
    return <p className="vacio">Todavía no hay datos para graficar.</p>
  }

  const W = 760, H = alto
  const M = { arriba: 16, derecha: 46, abajo: 28, izquierda: 38 }
  const ancho = W - M.izquierda - M.derecha
  const altoUtil = H - M.arriba - M.abajo

  const conDato = datos.filter(d => d.valor != null) as { etiqueta: string; valor: number; detalle?: string }[]
  const max = Math.max(100, ...conDato.map(d => d.valor))
  const x = (i: number) => M.izquierda +
    (datos.length === 1 ? ancho / 2 : (i / (datos.length - 1)) * ancho)
  const y = (v: number) => M.arriba + altoUtil - (v / max) * altoUtil

  // La linea se parte en tramos: donde no hubo ruta no se dibuja nada.
  const tramos: string[][] = []
  datos.forEach((d, i) => {
    if (d.valor == null) { tramos.push([]); return }
    const ultimoTramo = tramos[tramos.length - 1]
    const punto = `${x(i)},${y(d.valor)}`
    if (!ultimoTramo || ultimoTramo.length === 0) tramos.push([punto])
    else ultimoTramo.push(punto)
  })
  const caminos = tramos.filter(t => t.length > 0)
    .map(t => `M${t.join(' L')}`)
  const areas = tramos.filter(t => t.length > 1).map(t => {
    const x1 = t[0].split(',')[0], x2 = t[t.length - 1].split(',')[0]
    return `M${t.join(' L')} L${x2},${M.arriba + altoUtil} L${x1},${M.arriba + altoUtil} Z`
  })

  const ticks = [0, 50, 100].filter(t => t <= max)
  const iUltimo = datos.map(d => d.valor).reduce<number>(
    (acc, v, i) => (v != null ? i : acc), -1)
  const ultimo = iUltimo >= 0 ? datos[iUltimo] : null

  // Cada cuantos puntos se escribe una fecha, para que no se encimen.
  const cada = Math.ceil(datos.length / 7)

  function alMover(e: React.MouseEvent<SVGSVGElement>) {
    const caja = e.currentTarget.getBoundingClientRect()
    const px = ((e.clientX - caja.left) / caja.width) * W
    const i = Math.round(((px - M.izquierda) / ancho) * (datos.length - 1))
    setSobre(Math.max(0, Math.min(datos.length - 1, i)))
  }

  return (
    <div className="grafica">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={titulo}
           onMouseMove={alMover} onMouseLeave={() => setSobre(null)}>
        <defs>
          <linearGradient id={`g${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={AZUL} stopOpacity="0.14" />
            <stop offset="100%" stopColor={AZUL} stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {ticks.map(t => (
          <g key={t}>
            <line x1={M.izquierda} x2={W - M.derecha} y1={y(t)} y2={y(t)}
                  stroke={BORDE} strokeWidth="1" />
            <text x={M.izquierda - 8} y={y(t) + 4} textAnchor="end"
                  fontSize="11" fill={TINTA2}>{t}{sufijo}</text>
          </g>
        ))}

        {areas.map((d, i) => <path key={`a${i}`} d={d} fill={`url(#g${id})`} />)}
        {caminos.map((d, i) => (
          <path key={`l${i}`} d={d} fill="none" stroke={AZUL} strokeWidth="2"
                strokeLinejoin="round" strokeLinecap="round" />
        ))}
        {/* Un dia suelto entre dos sin ruta no forma tramo: se marca
            con su punto, o desapareceria de la grafica. */}
        {datos.map((d, i) => d.valor != null &&
          (datos[i - 1]?.valor == null && datos[i + 1]?.valor == null) && (
            <circle key={`s${i}`} cx={x(i)} cy={y(d.valor)} r="4"
                    fill={AZUL} stroke="#FFFFFF" strokeWidth="2" />
        ))}

        {datos.map((d, i) => (i % cada === 0 || i === datos.length - 1) && (
          <text key={d.etiqueta} x={x(i)} y={H - 8} textAnchor="middle"
                fontSize="11" fill={TINTA2}>{d.etiqueta}</text>
        ))}

        {/* El extremo se etiqueta; los demas los cuenta el hover. */}
        {ultimo?.valor != null && (
          <>
            <circle cx={x(iUltimo)} cy={y(ultimo.valor)} r="4.5"
                    fill={AZUL} stroke="#FFFFFF" strokeWidth="2" />
            <text x={x(iUltimo) + 10} y={y(ultimo.valor) + 4}
                  fontSize="12" fontWeight="600" fill="#1C1A17">
              {ultimo.valor}{sufijo}
            </text>
          </>
        )}

        {sobre != null && (
          <g>
            <line x1={x(sobre)} x2={x(sobre)} y1={M.arriba} y2={M.arriba + altoUtil}
                  stroke={TINTA2} strokeWidth="1" />
            {datos[sobre].valor != null && (
              <circle cx={x(sobre)} cy={y(datos[sobre].valor!)} r="4.5"
                      fill={AZUL} stroke="#FFFFFF" strokeWidth="2" />
            )}
          </g>
        )}
      </svg>

      <div className="grafica-pie" aria-live="polite">
        {sobre != null
          ? <><b>{datos[sobre].etiqueta}</b>:{' '}
              {datos[sobre].valor == null
                ? 'sin ruta programada'
                : <>{datos[sobre].valor}{sufijo}
                    {datos[sobre].detalle && <> · {datos[sobre].detalle}</>}</>}</>
          : <span className="apagado">Pasa el puntero por la gráfica para ver cada día.</span>}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------
// Barras horizontales
// ---------------------------------------------------------------------

export function GraficaBarras({ datos, sufijo = '', titulo }: {
  datos: Punto[]; sufijo?: string; titulo: string
}) {
  const [sobre, setSobre] = useState<number | null>(null)

  if (datos.length === 0) {
    return <p className="vacio">Todavía no hay datos para graficar.</p>
  }

  const max = Math.max(100, ...datos.map(d => d.valor ?? 0))

  return (
    <div className="barras" role="img" aria-label={titulo}>
      {datos.map((d, i) => (
        <div key={d.etiqueta} className="barra-fila"
             onMouseEnter={() => setSobre(i)} onMouseLeave={() => setSobre(null)}>
          <span className="barra-nombre" title={d.etiqueta}>{d.etiqueta}</span>
          <span className="barra-pista">
            <span className="barra-valor"
                  style={{ width: `${Math.max(1, ((d.valor ?? 0) / max) * 100)}%` }} />
          </span>
          <span className="barra-cifra">{d.valor == null ? '—' : `${d.valor}${sufijo}`}</span>
          {sobre === i && d.detalle && (
            <span className="barra-detalle">{d.detalle}</span>
          )}
        </div>
      ))}
    </div>
  )
}
