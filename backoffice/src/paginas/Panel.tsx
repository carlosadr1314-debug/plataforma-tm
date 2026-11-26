import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useSesion } from '../lib/sesion'
import { GraficaLinea, GraficaBarras, type Punto } from '../componentes/Graficas'

// =====================================================================
// Panel
//
// La primera pantalla del dia. Antes era una tabla de cuantos
// registros hay de cada cosa, que se lee una vez y despues nunca:
// saber que hay 14 puntos de venta no cambia nada de lo que uno hace.
//
// Lo que si cambia algo es el cumplimiento: cuanto de lo programado
// se esta haciendo, como viene la tendencia, y quien se esta quedando
// atras. De ahi se sale a Visitas o a Jornadas a ver el detalle.
//
// El inventario de registros se queda, pero abajo y en chico, que es
// el peso que tiene.
// =====================================================================

const DIAS = 14

type Parada = {
  fecha_programada: string
  usuario: { nombre: string } | null
  cliente: { nombre: string } | null
  visita: { estado: string; distancia_pdv: number | null }[] | { estado: string; distancia_pdv: number | null } | null
}

const unaVisita = (v: Parada['visita']) => (Array.isArray(v) ? v[0] : v) ?? null

const hoyISO = () => {
  const d = new Date()
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
}

function haceDias(n: number) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
}

const diaCorto = (f: string) =>
  new Date(f + 'T12:00:00').toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })

/** El cumplimiento de un grupo de paradas: completadas sobre programadas. */
function cumplimiento(paradas: Parada[]) {
  if (paradas.length === 0) return 0
  const hechas = paradas.filter(p => unaVisita(p.visita)?.estado === 'completada').length
  return Math.round((hechas / paradas.length) * 100)
}

export default function Panel() {
  const { perfil } = useSesion()
  const ir = useNavigate()

  const [paradas, setParadas] = useState<Parada[]>([])
  const [cuenta, setCuenta] = useState<Record<string, number | null>>({})
  const [cargando, setCargando] = useState(true)
  const [aviso, setAviso] = useState('')

  const cargar = useCallback(async () => {
    setCargando(true); setAviso('')
    const desde = haceDias(DIAS - 1)

    const { data, error } = await supabase.from('itinerario')
      .select('fecha_programada,usuario:usuario_id(nombre),cliente:cliente_id(nombre),visita(estado,distancia_pdv)')
      .gte('fecha_programada', desde)
      .lte('fecha_programada', hoyISO())

    if (error) setAviso('No se pudo cargar el cumplimiento. ' + error.message)
    setParadas((data as any) ?? [])

    const tablas = ['pdv', 'sku', 'usuario', 'formulario']
    const r: Record<string, number | null> = {}
    await Promise.all(tablas.map(async t => {
      const { count } = await supabase.from(t).select('*', { count: 'exact', head: true })
      r[t] = count
    }))
    setCuenta(r)
    setCargando(false)
  }, [])

  useEffect(() => { cargar() }, [cargar])

  // --- lo que se grafica -------------------------------------------
  const porDia: Punto[] = useMemo(() => {
    const dias: Punto[] = []
    for (let i = DIAS - 1; i >= 0; i--) {
      const f = haceDias(i)
      const delDia = paradas.filter(p => p.fecha_programada === f)
      // Sin ruta programada no hay cumplimiento que medir. Dibujarlo
      // como 0% diria que no cumplieron, y no habia nada que cumplir.
      dias.push({
        etiqueta: diaCorto(f),
        valor: delDia.length === 0 ? null : cumplimiento(delDia),
        detalle: `${delDia.filter(p => unaVisita(p.visita)?.estado === 'completada').length} de ${delDia.length}`,
      })
    }
    return dias
  }, [paradas])

  const porPromotor: Punto[] = useMemo(() => {
    const m = new Map<string, Parada[]>()
    paradas.forEach(p => {
      const k = p.usuario?.nombre ?? 'Sin asignar'
      if (!m.has(k)) m.set(k, [])
      m.get(k)!.push(p)
    })
    return [...m.entries()]
      .map(([nombre, ps]) => ({
        etiqueta: nombre,
        valor: cumplimiento(ps),
        detalle: `${ps.filter(x => unaVisita(x.visita)?.estado === 'completada').length} de ${ps.length} en ${DIAS} días`,
      }))
      .sort((a, b) => b.valor - a.valor)
  }, [paradas])

  // --- los numeros de arriba ---------------------------------------
  const hoy = hoyISO()
  const deHoy = paradas.filter(p => p.fecha_programada === hoy)
  const total = paradas.length
  const hechas = paradas.filter(p => unaVisita(p.visita)?.estado === 'completada').length
  const sinRegistro = paradas.filter(p => !unaVisita(p.visita)).length
  const general = cumplimiento(paradas)

  return (
    <>
      <div className="tope">
        <div>
          <h2 className="disp">Panel</h2>
          <p>
            {cargando ? 'Cargando…'
              : `Últimos ${DIAS} días · ${perfil?.nombre} · ${perfil?.perfil}`}
          </p>
        </div>
      </div>

      {aviso !== '' && <div className="aviso error" role="alert">{aviso}</div>}

      <div className="tarjetas">
        <button type="button" className="tarjeta hero" onClick={() => ir('/visitas')}>
          <span className="t-rotulo">Cumplimiento</span>
          <span className="t-cifra">{general}%</span>
          <span className="t-pie">{hechas} de {total} programadas</span>
        </button>

        <button type="button" className="tarjeta" onClick={() => ir('/visitas')}>
          <span className="t-rotulo">Hoy</span>
          <span className="t-cifra">{deHoy.length}</span>
          <span className="t-pie">
            {deHoy.length === 0 ? 'sin ruta programada'
              : `${cumplimiento(deHoy)}% hecho`}
          </span>
        </button>

        <button type="button"
          className={'tarjeta' + (sinRegistro > 0 ? ' ojo' : '')}
          onClick={() => ir('/visitas')}>
          <span className="t-rotulo">Sin registro</span>
          <span className="t-cifra">{sinRegistro}</span>
          <span className="t-pie">
            {sinRegistro === 0 ? 'todas tienen registro' : 'requieren revisión'}
          </span>
        </button>

        <button type="button" className="tarjeta" onClick={() => ir('/jornadas')}>
          <span className="t-rotulo">Jornadas</span>
          <span className="t-cifra">›</span>
          <span className="t-pie">check-in, comida y alertas</span>
        </button>
      </div>

      <h3 className="seccion">Cumplimiento por día</h3>
      <div className="panel-caja">
        {cargando ? <p className="vacio">Cargando…</p> : (
          <GraficaLinea datos={porDia} sufijo="%"
            titulo={`Cumplimiento diario de los últimos ${DIAS} días`} />
        )}
      </div>

      <h3 className="seccion">Cumplimiento por promotor</h3>
      <div className="panel-caja">
        {cargando ? <p className="vacio">Cargando…</p> : (
          <GraficaBarras datos={porPromotor} sufijo="%"
            titulo={`Cumplimiento por promotor en los últimos ${DIAS} días`} />
        )}
      </div>

      {/* Toda grafica necesita su version en tabla: para quien usa
          lector de pantalla, y para quien quiere el numero exacto. */}
      <details className="panel-tabla">
        <summary>Ver los números en tabla</summary>
        <div className="tabla" style={{ marginTop: 10 }}>
          <table>
            <thead>
              <tr>
                <th scope="col">Día</th>
                <th scope="col" className="num">Programadas</th>
                <th scope="col" className="num">Completadas</th>
                <th scope="col" className="num">Cumplimiento</th>
              </tr>
            </thead>
            <tbody>
              {porDia.map((d, i) => {
                const f = haceDias(DIAS - 1 - i)
                const delDia = paradas.filter(p => p.fecha_programada === f)
                return (
                  <tr key={d.etiqueta}>
                    <td>{d.etiqueta}</td>
                    <td className="num">{delDia.length}</td>
                    <td className="num">
                      {delDia.filter(p => unaVisita(p.visita)?.estado === 'completada').length}
                    </td>
                    <td className="num">{delDia.length === 0 ? '—' : `${d.valor}%`}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </details>

      <h3 className="seccion">Lo que hay dado de alta</h3>
      <div className="inventario">
        {([['Puntos de venta', 'pdv'], ['SKUs en catálogo', 'sku'],
           ['Usuarios', 'usuario'], ['Formularios', 'formulario']] as [string, string][])
          .map(([etiqueta, t]) => (
            <div key={t} className="inv-item">
              <span className="inv-cifra">{cuenta[t] ?? '—'}</span>
              <span className="inv-rotulo">{etiqueta}</span>
            </div>
          ))}
      </div>
      <p className="nota-panel">
        Todo lo de esta pantalla ya pasó por las políticas de seguridad: cada
        perfil ve únicamente lo que le corresponde.
      </p>
    </>
  )
}
