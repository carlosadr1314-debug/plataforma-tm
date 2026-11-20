import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'

// El panel cuelga del PLAN, no de lo capturado. Si colgara de visita,
// una parada que nadie toco no existiria: el cumplimiento saldria
// "2 de 2" cuando se programaron cinco, y un dia sin trabajo se veria
// igual que un dia sin ruta.
type Visita = {
  id: string; estado: string
  check_in: string | null; check_out: string | null
  check_in_precision: number | null; distancia_pdv: number | null
  minutos_desfase: number | null; ubicacion_simulada: boolean
  motivo_no_visita: string | null; sincronizada_en: string | null
  evidencia: { count: number }[]
}
type Parada = {
  id: string
  fecha_programada: string; hora_estimada: string | null
  usuario: { nombre: string } | null
  pdv: { codigo: string; nombre: string; ciudad: string | null; radio_checkin: number } | null
  tarea: { nombre: string } | null
  visita: Visita | Visita[] | null
}

// La relacion llega como objeto o como lista de uno, segun resuelva
// el servidor.
const unaVisita = (v: Parada['visita']): Visita | null =>
  (Array.isArray(v) ? v[0] : v) ?? null

/**
 * El estado que se le enseña a la oficina. Son cinco, no cuatro:
 * "sin registro" es la parada que nadie toco, e "intento" es aquella
 * donde el promotor llego pero el GPS lo dejo fuera del radio y no se
 * le permitio registrar. Esas dos se veian igual —no existian— y son
 * cosas muy distintas: una es un promotor que no trabajo, la otra un
 * radio mal capturado.
 */
function estadoDeParada(p: Parada) {
  const v = unaVisita(p.visita)
  if (!v) return 'sin_registro'
  if (v.estado === 'programada') {
    return v.distancia_pdv != null ? 'intento' : 'sin_registro'
  }
  return v.estado
}
type Respuesta = {
  id: string
  valor_texto: string | null; valor_numero: number | null
  valor_bool: boolean | null; valor_fecha: string | null; valor_opcion: any
  pregunta: { texto: string; tipo: string; orden: number } | null
}
type Foto = {
  id: string; storage_path: string; bytes: number | null
  lat: number | null; lng: number | null; tomada_en: string | null
  url?: string | null
}

function diaLocal(desfase = 0) {
  const d = new Date()
  d.setDate(d.getDate() + desfase)
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
}
const hhmm = (t: string | null | undefined) =>
  t ? new Date(t).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }) : '—'
const duracion = (a: string | null | undefined, b: string | null | undefined) => {
  if (!a || !b) return '—'
  const m = Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000)
  return m + ' min'
}
const pesos = (n: number) => n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })
const kb = (n: number | null) => (n ? Math.round(n / 1024) + ' KB' : '—')

const ETIQUETA: Record<string, { txt: string; clase: string }> = {
  completada:   { txt: 'COMPLETADA',  clase: 'c-ok' },
  en_curso:     { txt: 'EN CURSO',    clase: 'c-cur' },
  programada:   { txt: 'PROGRAMADA',  clase: 'c-pen' },
  no_realizada: { txt: 'NO REALIZADA', clase: 'c-err' },
  intento:      { txt: 'INTENTO FUERA DE RADIO', clase: 'c-err' },
  sin_registro: { txt: 'SIN REGISTRO', clase: 'c-pen' },
}

export default function Visitas() {
  const [desde, setDesde] = useState(diaLocal(-6))
  const [hasta, setHasta] = useState(diaLocal())
  const [lista, setLista] = useState<Parada[]>([])
  const [cargando, setCargando] = useState(true)
  const [aviso, setAviso] = useState('')

  const [sel, setSel] = useState<Parada | null>(null)
  const [respuestas, setRespuestas] = useState<Respuesta[]>([])
  const [opciones, setOpciones] = useState<Record<string, string>>({})
  const [fotos, setFotos] = useState<Foto[]>([])
  const [cargandoDet, setCargandoDet] = useState(false)

  const cargar = useCallback(async () => {
    setCargando(true); setAviso('')
    const { data, error } = await supabase.from('itinerario')
      .select(`id,fecha_programada,hora_estimada,
               usuario:usuario_id(nombre),
               pdv:pdv_id(codigo,nombre,ciudad,radio_checkin),
               tarea:tarea_id(nombre),
               visita(id,estado,check_in,check_out,check_in_precision,distancia_pdv,
                      minutos_desfase,ubicacion_simulada,motivo_no_visita,
                      sincronizada_en,evidencia(count))`)
      .gte('fecha_programada', desde)
      .lte('fecha_programada', hasta)
    if (error) setAviso('No se pudieron cargar las visitas. ' + error.message)
    const filas = ((data as any) ?? []) as Parada[]
    filas.sort((a, b) => {
      if (a.fecha_programada !== b.fecha_programada)
        return b.fecha_programada.localeCompare(a.fecha_programada)
      // Dentro del dia, por hora programada: es el orden de la ruta, y
      // deja juntas las paradas que nadie toco.
      return (a.hora_estimada ?? '').localeCompare(b.hora_estimada ?? '')
    })
    setLista(filas)
    setCargando(false)
  }, [desde, hasta])

  useEffect(() => { cargar() }, [cargar])

  async function abrir(p: Parada) {
    setSel(p); setRespuestas([]); setFotos([])
    const v = unaVisita(p.visita)
    // Una parada sin registro no tiene nada que traer.
    if (!v) { setCargandoDet(false); return }
    setCargandoDet(true)

    const { data: rs } = await supabase.from('respuesta')
      .select('id,valor_texto,valor_numero,valor_bool,valor_fecha,valor_opcion,pregunta:pregunta_id(texto,tipo,orden)')
      .eq('visita_id', v.id)
    const ordenadas = ((rs as any) ?? []) as Respuesta[]
    ordenadas.sort((a, b) => (a.pregunta?.orden ?? 0) - (b.pregunta?.orden ?? 0))
    setRespuestas(ordenadas)

    // texto de las opciones elegidas
    const ids: string[] = []
    ordenadas.forEach(r => {
      if (Array.isArray(r.valor_opcion)) ids.push(...r.valor_opcion)
    })
    if (ids.length) {
      const { data: ops } = await supabase.from('opcion_pregunta')
        .select('id,texto').in('id', ids)
      const mapa: Record<string, string> = {}
      ;(ops ?? []).forEach(o => { mapa[o.id] = o.texto })
      setOpciones(mapa)
    }

    const { data: ev } = await supabase.from('evidencia')
      .select('id,storage_path,bytes,lat,lng,tomada_en')
      .eq('visita_id', v.id).order('tomada_en')
    const archivos = ((ev as any) ?? []) as Foto[]

    // La imagen solo existe cuando la subio la aplicacion movil.
    // Si no esta, se muestra la ficha del archivo en su lugar.
    for (const f of archivos) {
      try {
        const { data: firmada } = await supabase.storage
          .from('evidencia').createSignedUrl(f.storage_path, 300)
        f.url = firmada?.signedUrl ?? null
      } catch { f.url = null }
    }
    setFotos(archivos)
    setCargandoDet(false)
  }

  function textoRespuesta(r: Respuesta) {
    const t = r.pregunta?.tipo
    if (r.valor_bool !== null) return r.valor_bool ? 'Sí' : 'No'
    if (r.valor_numero !== null) {
      return t === 'precio_sku' ? pesos(Number(r.valor_numero)) : String(r.valor_numero)
    }
    if (r.valor_fecha) return r.valor_fecha
    if (Array.isArray(r.valor_opcion) && r.valor_opcion.length) {
      return r.valor_opcion.map((id: string) => opciones[id] ?? '—').join(', ')
    }
    if (r.valor_texto) return r.valor_texto
    return '—'
  }

  // --- indicadores ------------------------------------------------------
  const total = lista.length                       // paradas programadas
  const conEstado = (e: string) => lista.filter(p => estadoDeParada(p) === e).length
  const hechas = conEstado('completada')
  const curso = conEstado('en_curso')
  const fallidas = conEstado('no_realizada')
  const intentos = conEstado('intento')
  const sinRegistro = conEstado('sin_registro')

  // Fuera de radio: tanto las que se registraron lejos como los
  // intentos bloqueados. Las dos ameritan revisar el radio o al
  // promotor.
  const lejos = lista.filter(p => {
    const v = unaVisita(p.visita)
    return v?.distancia_pdv != null &&
           v.distancia_pdv > (p.pdv?.radio_checkin ?? 150)
  }).length

  // El denominador son las programadas, no las registradas: esa era
  // la cuenta que inflaba el numero.
  const cumplimiento = total ? Math.round((hechas / total) * 100) : 0
  const fotosTotal = lista.reduce(
    (n, p) => n + (unaVisita(p.visita)?.evidencia?.[0]?.count ?? 0), 0)

  return (
    <>
      <div className="tope">
        <div>
          <h2 className="disp">Panel de visitas</h2>
          <p>{cargando ? 'Cargando…' : `${total} visitas en el periodo`}</p>
        </div>
      </div>

      {aviso && <div className="aviso error" role="alert">{aviso}</div>}

      <div className="filtros">
        <div className="campo">
          <label htmlFor="v-desde">Desde</label>
          <input id="v-desde" type="date" value={desde}
            onChange={e => setDesde(e.target.value)} />
        </div>
        <div className="campo">
          <label htmlFor="v-hasta">Hasta</label>
          <input id="v-hasta" type="date" value={hasta}
            onChange={e => setHasta(e.target.value)} />
        </div>
        <button type="button" className="btn sec" style={{ minHeight: 44 }}
          onClick={() => { setDesde(diaLocal()); setHasta(diaLocal()) }}>
          Solo hoy
        </button>
      </div>

      <div className="kpis">
        <div className="kpi destacado">
          <span>Cumplimiento</span>
          <b className="num">{cumplimiento}%</b>
          <i className={cumplimiento >= 85 ? 'bien' : 'alerta'}>
            {hechas} de {total} programadas
          </i>
        </div>
        <div className="kpi">
          <span>Sin registro</span>
          <b className="num">{sinRegistro}</b>
          <i className={sinRegistro ? 'alerta' : 'bien'}>
            {sinRegistro ? 'Nadie las tocó' : 'Todas tienen registro'}
          </i>
        </div>
        <div className="kpi">
          <span>En curso</span>
          <b className="num">{curso}</b>
          <i>{fallidas} no realizadas · {intentos} intento{intentos === 1 ? '' : 's'}</i>
        </div>
        <div className="kpi">
          <span>Fuera de radio</span>
          <b className="num">{lejos}</b>
          <i className={lejos ? 'alerta' : 'bien'}>
            {lejos ? 'Requieren revisión' : 'Sin incidencias'}
          </i>
        </div>
        <div className="kpi">
          <span>Evidencia</span>
          <b className="num">{fotosTotal}</b>
          <i>fotografías capturadas</i>
        </div>
      </div>

      <div className="tabla">
        {cargando ? <p className="vacio">Cargando visitas…</p>
          : total === 0 ? (
            <p className="vacio">
              No hay paradas programadas en este periodo.<br />
              Las rutas se arman en Itinerarios; las visitas las genera la
              aplicación del promotor al trabajar en campo.
            </p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Fecha</th><th>Hora</th><th>Punto de venta</th><th>Promotor</th>
                  <th>Entrada</th><th>Duración</th><th>Distancia</th>
                  <th>Fotos</th><th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {lista.map(p => {
                  const v = unaVisita(p.visita)
                  const e = estadoDeParada(p)
                  const et = ETIQUETA[e] ?? { txt: e, clase: 'c-pen' }
                  const radio = p.pdv?.radio_checkin ?? 150
                  const fuera = v?.distancia_pdv != null && v.distancia_pdv > radio
                  return (
                    <tr key={p.id}
                      className={'clic' + (sel?.id === p.id ? ' on' : '')
                                 + (e === 'sin_registro' ? ' sin-tocar' : '')}
                      onClick={() => abrir(p)}>
                      <td className="num">{p.fecha_programada}</td>
                      <td className="num">{p.hora_estimada?.slice(0, 5) ?? '—'}</td>
                      <td>
                        <b>{p.pdv?.codigo}</b><br />
                        <span style={{ color: 'var(--tinta-2)', fontSize: 11.5 }}>
                          {p.pdv?.nombre}</span>
                      </td>
                      <td>{p.usuario?.nombre ?? '—'}</td>
                      <td className="num">{hhmm(v?.check_in ?? null)}</td>
                      <td className="num">{duracion(v?.check_in ?? null, v?.check_out ?? null)}</td>
                      <td className="num" style={fuera ? { color: 'var(--error)', fontWeight: 600 } : undefined}>
                        {v?.distancia_pdv != null ? Math.round(v.distancia_pdv) + ' m' : '—'}
                      </td>
                      <td className="num">{v?.evidencia?.[0]?.count ?? 0}</td>
                      <td><span className={'chip ' + et.clase}>{et.txt}</span></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
      </div>

      {/* ---------------- detalle ---------------- */}
      {sel && (() => { const sv = unaVisita(sel.visita); return (
        <>
          <div className="velo" onClick={() => setSel(null)} />
          <div className="panel" role="dialog" aria-modal="true" aria-label="Detalle de la visita">
            <h3>{sel.pdv?.codigo} · {sel.pdv?.nombre}</h3>

            {!sv && (
              <div className="aviso" style={{ background: 'var(--arena)',
                   border: '1px solid var(--borde)' }}>
                <b>Nadie tocó esta parada.</b> Estaba programada y no hay
                registro de que el promotor haya abierto la visita en su
                teléfono, ni siquiera un intento. Si traía jornada abierta,
                el rastro del día dice por dónde anduvo.
              </div>
            )}

            {sv && sv.estado === 'programada' && sv.distancia_pdv != null && (
              <div className="aviso error">
                <b>Intento fuera de radio.</b> El promotor llegó y la aplicación
                no lo dejó registrar: el GPS lo puso a {Math.round(sv.distancia_pdv)} m
                de la tienda, con el radio en {sel.pdv?.radio_checkin ?? 150} m.
                Si se repite en esta tienda, lo que está mal es su radio.
              </div>
            )}

            <div className="det-bloque">
              <h4>Registro de entrada</h4>
              <ul className="det-lista">
                <li><span className="et">Promotor</span>
                  <span className="vl">{sel.usuario?.nombre ?? '—'}</span></li>
                <li><span className="et">Fecha</span>
                  <span className="vl num">{sel.fecha_programada}</span></li>
                <li><span className="et">Hora programada</span>
                  <span className="vl num">{sel.hora_estimada?.slice(0, 5) ?? '—'}</span></li>
                <li><span className="et">Entrada real</span>
                  <span className="vl num">{hhmm(sv?.check_in)}</span></li>
                <li><span className="et">Salida</span>
                  <span className="vl num">{hhmm(sv?.check_out)}</span></li>
                <li><span className="et">Duración</span>
                  <span className="vl num">{duracion(sv?.check_in, sv?.check_out)}</span></li>
                <li><span className="et">Desfase</span>
                  <span className="vl num">
                    {sv?.minutos_desfase != null ? sv?.minutos_desfase + ' min' : '—'}</span></li>
              </ul>
            </div>

            <div className="det-bloque">
              <h4>Ubicación</h4>
              <ul className="det-lista">
                <li><span className="et">Distancia a la tienda</span>
                  <span className="vl num">
                    {sv?.distancia_pdv != null ? Math.round(sv?.distancia_pdv) + ' m' : '—'}</span></li>
                <li><span className="et">Radio permitido</span>
                  <span className="vl num">{sel.pdv?.radio_checkin ?? '—'} m</span></li>
                <li><span className="et">Precisión del GPS</span>
                  <span className="vl num">
                    {sv?.check_in_precision != null ? '±' + Math.round(sv?.check_in_precision) + ' m' : '—'}</span></li>
                <li><span className="et">Ubicación simulada</span>
                  <span className="vl">{sv?.ubicacion_simulada ? 'Sí, detectada' : 'No'}</span></li>
              </ul>
            </div>

            {sv?.motivo_no_visita && (
              <div className="aviso error" role="note">
                Visita no realizada: {sv?.motivo_no_visita}
              </div>
            )}

            {cargandoDet ? (
              <p className="nota-panel">Cargando detalle…</p>
            ) : (
              <>
                {respuestas.length > 0 && (
                  <div className="det-bloque">
                    <h4>Respuestas del formulario</h4>
                    {respuestas.map(r => (
                      <div className="resp" key={r.id}>
                        <div className="p">{r.pregunta?.texto}</div>
                        <div className="r">{textoRespuesta(r)}</div>
                      </div>
                    ))}
                  </div>
                )}

                {fotos.length > 0 && (
                  <div className="det-bloque">
                    <h4>Evidencia fotográfica · {fotos.length}</h4>
                    <div className="fotos-det">
                      {fotos.map(f => (
                        <div className="foto-t" key={f.id}>
                          {f.url
                            ? <img src={f.url} alt="Evidencia de la visita" />
                            : <span>{kb(f.bytes)}<br />{hhmm(f.tomada_en)}</span>}
                          {f.url && <b>{hhmm(f.tomada_en)}</b>}
                        </div>
                      ))}
                    </div>
                    {fotos.every(f => !f.url) && (
                      <p className="nota-panel" style={{ marginTop: 10 }}>
                        Las imágenes se suben desde la aplicación del promotor. Aquí se
                        muestran los registros capturados con su peso y hora.
                      </p>
                    )}
                  </div>
                )}
              </>
            )}

            <button type="button" className="btn sec bloque"
              onClick={() => setSel(null)}>Cerrar</button>
          </div>
        </>
      ) })()}
    </>
  )
}
