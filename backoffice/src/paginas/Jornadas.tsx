import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import FotoAmpliada, { TITULO_EVIDENCIA, type FotoVista }
  from '../componentes/FotoAmpliada'

// =====================================================================
// Jornadas
//
// El dia del promotor visto desde la oficina: a que hora hizo su
// check-in de seguridad y desde donde, cuanto duro su comida contra lo
// que le tocaba, y si se alejo del punto de venta con una visita
// abierta.
//
// Es consulta, no panel en vivo: se mira cualquier rango de fechas,
// hoy incluido. Lo de hoy se ve igual que lo de la semana pasada, que
// es lo que pidio el cliente: que el reporte este en todo momento.
//
// Nota sobre la comida: lo que se reporta ya trae descontados los
// minutos de gracia, y eso lo decide la base (gracia_comida_min), no
// esta pantalla. El promotor no ve la gracia: su contador corre contra
// lo que se le asigno, a secas.
// =====================================================================

type Comida = {
  id: string; jornada_id: string; usuario_id: string; promotor: string; fecha: string
  inicio: string; fin: string | null
  minutos_asignados: number; minutos_tomados: number
  minutos_de_mas: number; abierta: boolean
}

type Jornada = {
  id: string; fecha: string; inicio: string; fin: string | null
  check_in_seguridad: string | null
  seguridad_lat: number | null; seguridad_lng: number | null
  usuario: { id: string; nombre: string } | null
}

/**
 * La foto con la que el promotor vuelve de comer. Cuelga de la
 * jornada y no de una visita: a esa hora no hay visita abierta, y por
 * eso no sale en el panel de Visitas. Aqui es donde tiene sentido
 * mirarla, junto al tiempo que se tomo.
 */
type FotoJornada = {
  id: string; jornada_id: string; storage_path: string
  bytes: number | null; lat: number | null; lng: number | null
  tomada_en: string | null; tipo: string
  url?: string | null
}

type Alerta = {
  id: string; salio_en: string; volvio_en: string | null
  distancia_max: number
  itinerario: {
    fecha_programada: string
    usuario: { nombre: string } | null
    pdv: { codigo: string; nombre: string; radio_checkin: number } | null
  } | null
}

const hhmm = (t: string | null | undefined) =>
  t ? new Date(t).toLocaleTimeString('es-MX',
        { hour: '2-digit', minute: '2-digit', hour12: false }) : '—'

const dia = (f: string) =>
  new Date(f + 'T12:00:00').toLocaleDateString('es-MX',
    { weekday: 'short', day: 'numeric', month: 'short' })

/** "1 h 10 min" a partir de minutos. */
function duracion(min: number) {
  const m = Math.max(0, Math.round(min))
  const h = Math.floor(m / 60), r = m % 60
  if (h === 0) return `${r} min`
  return r === 0 ? `${h} h` : `${h} h ${r} min`
}

function minutosEntre(a: string, b: string | null) {
  if (!b) return null
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000)
}

const hoyISO = () => {
  const d = new Date()
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
}

export default function Jornadas() {
  const [desde, setDesde] = useState(hoyISO())
  const [hasta, setHasta] = useState(hoyISO())
  const [jornadas, setJornadas] = useState<Jornada[]>([])
  const [comidas, setComidas] = useState<Comida[]>([])
  const [alertas, setAlertas] = useState<Alerta[]>([])
  const [fotos, setFotos] = useState<FotoJornada[]>([])
  const [verFoto, setVerFoto] = useState<FotoJornada | null>(null)
  const [cargando, setCargando] = useState(true)
  const [aviso, setAviso] = useState('')

  const cargar = useCallback(async () => {
    setCargando(true); setAviso('')

    const [j, c, a] = await Promise.all([
      supabase.from('jornada')
        .select('id,fecha,inicio,fin,check_in_seguridad,seguridad_lat,seguridad_lng,usuario:usuario_id(id,nombre)')
        .gte('fecha', desde).lte('fecha', hasta)
        .order('fecha', { ascending: false }).order('inicio', { ascending: false }),
      supabase.from('comida_reporte')
        .select('*').gte('fecha', desde).lte('fecha', hasta),
      supabase.from('alerta_radio')
        .select('id,salio_en,volvio_en,distancia_max,itinerario:itinerario_id(fecha_programada,usuario:usuario_id(nombre),pdv:pdv_id(codigo,nombre,radio_checkin))')
        .gte('salio_en', `${desde}T00:00:00`).lte('salio_en', `${hasta}T23:59:59`)
        .order('salio_en', { ascending: false }),
    ])

    if (j.error) setAviso('No se pudieron cargar las jornadas. ' + j.error.message)
    const lista = ((j.data as any) ?? []) as Jornada[]
    setJornadas(lista)
    setComidas((c.data as any) ?? [])
    setAlertas((a.data as any) ?? [])

    // Las fotos de la jornada. Se piden por los ids que acaban de
    // salir, no por fecha: evidencia no tiene fecha propia.
    if (lista.length > 0) {
      const { data: ev } = await supabase.from('evidencia')
        .select('id,jornada_id,storage_path,bytes,lat,lng,tomada_en,tipo')
        .in('jornada_id', lista.map(x => x.id))
        .order('tomada_en')
      const archivos = ((ev as any) ?? []) as FotoJornada[]

      // La URL se firma de a una; el bucket es privado y no se puede
      // enlazar directo.
      for (const f of archivos) {
        try {
          const { data: firmada } = await supabase.storage
            .from('evidencia').createSignedUrl(f.storage_path, 300)
          f.url = firmada?.signedUrl ?? null
        } catch { f.url = null }
      }
      setFotos(archivos)
    } else {
      setFotos([])
    }

    setCargando(false)
  }, [desde, hasta])

  useEffect(() => { cargar() }, [cargar])

  // Por jornada, no por promotor y fecha: la comida cuelga de UNA
  // jornada. Buscarla por (promotor, fecha) hacia que, con varias
  // jornadas el mismo dia, la misma comida saliera repetida en todos
  // los renglones.
  const comidaDe = (jornadaId: string) =>
    comidas.find(x => x.jornada_id === jornadaId) ?? null

  const fotoDe = (jornadaId: string, tipo: string) =>
    fotos.find(f => f.jornada_id === jornadaId && f.tipo === tipo) ?? null

  const excedidas = comidas.filter(c => c.minutos_de_mas > 0)
  const sinCheckIn = jornadas.filter(x => !x.check_in_seguridad).length

  return (
    <>
      <div className="encabezado">
        <div>
          <h2 className="disp">Jornadas</h2>
          <p className="sub">
            {cargando ? 'Cargando…' : (
              `${jornadas.length} jornada${jornadas.length === 1 ? '' : 's'}` +
              ` · ${excedidas.length} comida${excedidas.length === 1 ? '' : 's'} pasada${excedidas.length === 1 ? '' : 's'} de tiempo` +
              ` · ${alertas.length} alerta${alertas.length === 1 ? '' : 's'} de radio`
            )}
          </p>
        </div>
      </div>

      <div className="filtros">
        <div className="campo">
          <label htmlFor="j-desde">Desde</label>
          <input id="j-desde" type="date" value={desde}
                 onChange={e => setDesde(e.target.value)} />
        </div>
        <div className="campo">
          <label htmlFor="j-hasta">Hasta</label>
          <input id="j-hasta" type="date" value={hasta}
                 onChange={e => setHasta(e.target.value)} />
        </div>
      </div>

      {aviso !== '' && <div className="aviso error">{aviso}</div>}

      {sinCheckIn > 0 && (
        <div className="aviso ojo">
          {sinCheckIn === 1
            ? 'Hay 1 jornada abierta sin check-in de seguridad. Son de antes de que el check-in existiera.'
            : `Hay ${sinCheckIn} jornadas sin check-in de seguridad. Son de antes de que el check-in existiera.`}
        </div>
      )}

      {/* ---------------- el dia de cada quien ---------------- */}
      <h3 className="seccion">El día de cada quien</h3>
      <div className="tabla">
        <table>
          <thead>
            <tr>
              <th scope="col">Día</th>
              <th scope="col">Promotor</th>
              <th scope="col">Check-in</th>
              <th scope="col">Cierre</th>
              <th scope="col">Comida</th>
              <th scope="col">Regreso</th>
              <th scope="col" className="num">De más</th>
            </tr>
          </thead>
          <tbody>
            {jornadas.map(j => {
              const cm = comidaDe(j.id)
              return (
                <tr key={j.id}>
                  <td>{dia(j.fecha)}</td>
                  <td><b>{j.usuario?.nombre ?? '—'}</b></td>
                  <td className="cifras">
                    {j.check_in_seguridad ? hhmm(j.check_in_seguridad) : <i>sin check-in</i>}
                    {j.seguridad_lat != null && (
                      <><br /><small>{j.seguridad_lat.toFixed(4)}, {j.seguridad_lng?.toFixed(4)}</small></>
                    )}
                  </td>
                  <td className="cifras">{j.fin ? hhmm(j.fin) : <i>abierta</i>}</td>
                  <td className="cifras">
                    {!cm ? <i>no la tomó</i> : (
                      <>
                        {hhmm(cm.inicio)}–{cm.fin ? hhmm(cm.fin) : '…'}
                        <br />
                        <small>
                          {duracion(cm.minutos_tomados)} de {duracion(cm.minutos_asignados)}
                          {cm.abierta && ' · sigue en comida'}
                        </small>
                      </>
                    )}
                  </td>
                  <td>{(() => {
                    const fr = fotoDe(j.id, 'regreso_comida')
                    if (!fr) return cm ? <i>sin foto</i> : '—'
                    if (!fr.url) return <i>no disponible</i>
                    return (
                      <button type="button" className="foto-chica"
                              onClick={() => setVerFoto(fr)}
                              title="Foto con la que volvió de comer"
                              aria-label="Ampliar la foto de regreso de la comida">
                        <img src={fr.url} alt="Regreso de la comida" />
                      </button>
                    )
                  })()}</td>
                  <td className="num">
                    {!cm ? '—' : cm.minutos_de_mas > 0
                      ? <span className="de-mas">+{cm.minutos_de_mas} min</span>
                      : <span className="en-tiempo">en tiempo</span>}
                  </td>
                </tr>
              )
            })}
            {!cargando && jornadas.length === 0 && (
              <tr><td colSpan={7} className="vacio">
                No hay jornadas en estas fechas.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ---------------- alertas de radio ---------------- */}
      <h3 className="seccion">Se alejó del punto de venta</h3>
      <p className="nota-panel">
        Veces que el promotor se alejó de la tienda con la visita abierta. No es
        una falta por sí sola: un mandado de cinco minutos se ve igual que
        irse. Lo que dice es dónde mirar.
      </p>
      <div className="tabla">
        <table>
          <thead>
            <tr>
              <th scope="col">Día</th>
              <th scope="col">Promotor</th>
              <th scope="col">Punto de venta</th>
              <th scope="col">Se fue</th>
              <th scope="col">Volvió</th>
              <th scope="col" className="num">Fuera</th>
              <th scope="col" className="num">Lo más lejos</th>
            </tr>
          </thead>
          <tbody>
            {alertas.map(a => {
              const fuera = minutosEntre(a.salio_en, a.volvio_en)
              return (
                <tr key={a.id}>
                  <td>{a.itinerario ? dia(a.itinerario.fecha_programada) : '—'}</td>
                  <td><b>{a.itinerario?.usuario?.nombre ?? '—'}</b></td>
                  <td>
                    {a.itinerario?.pdv?.codigo ?? '—'}
                    <br /><small>{a.itinerario?.pdv?.nombre ?? ''}</small>
                  </td>
                  <td className="cifras">{hhmm(a.salio_en)}</td>
                  <td className="cifras">
                    {a.volvio_en ? hhmm(a.volvio_en) : <i>no volvió</i>}
                  </td>
                  <td className="num">{fuera == null ? '—' : duracion(fuera)}</td>
                  <td className="num">
                    {a.distancia_max} m
                    {a.itinerario?.pdv && (
                      <><br /><small>radio {a.itinerario.pdv.radio_checkin} m</small></>
                    )}
                  </td>
                </tr>
              )
            })}
            {!cargando && alertas.length === 0 && (
              <tr><td colSpan={7} className="vacio">
                Nadie se alejó de su punto de venta en estas fechas.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
      {verFoto && (
        <FotoAmpliada
          foto={{ ...verFoto,
                  titulo: TITULO_EVIDENCIA[verFoto.tipo] ?? 'Evidencia de la jornada',
                } as FotoVista}
          onCerrar={() => setVerFoto(null)} />
      )}
    </>
  )
}
