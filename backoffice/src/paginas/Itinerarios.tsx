import { useEffect, useState, useCallback, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useSesion, puede } from '../lib/sesion'

type Parada = {
  id: string; secuencia: number; hora_estimada: string | null
  usuario: { id: string; nombre: string } | null
  pdv: { codigo: string; nombre: string; ciudad: string | null } | null
  tarea: { nombre: string } | null
}
type Opcion = { id: string; nombre: string }
type Tarea = {
  id: string; nombre: string; vigencia_ini: string; vigencia_fin: string
  activa: boolean; formulario: { nombre: string } | null
}

function hoyLocal() {
  const d = new Date()
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
}
const soloHora = (h: string | null) => (h ? h.slice(0, 5) : '—')
const fechaLarga = (f: string) => {
  const [a, m, d] = f.split('-').map(Number)
  return new Date(a, m - 1, d).toLocaleDateString('es-MX',
    { weekday: 'long', day: 'numeric', month: 'long' })
}

export default function Itinerarios() {
  const { perfil } = useSesion()
  const editable = puede(perfil, 'gestionar_itinerarios')

  const [fecha, setFecha] = useState(hoyLocal())
  const [clientes, setClientes] = useState<Opcion[]>([])
  const [cliente, setCliente] = useState('')

  const [paradas, setParadas] = useState<Parada[]>([])
  const [promotores, setPromotores] = useState<Opcion[]>([])
  const [pdvs, setPdvs] = useState<{ id: string; codigo: string; nombre: string }[]>([])
  const [tareas, setTareas] = useState<Tarea[]>([])
  const [formularios, setFormularios] = useState<Opcion[]>([])

  const [cargando, setCargando] = useState(true)
  const [aviso, setAviso] = useState('')
  const [ok, setOk] = useState('')

  const [abierto, setAbierto] = useState(false)
  const [form, setForm] = useState({ usuario_id: '', pdv_id: '', tarea_id: '', hora: '09:00' })
  const [errores, setErrores] = useState<Record<string, string>>({})
  const [guardando, setGuardando] = useState(false)

  const [destino, setDestino] = useState('')
  const [copiando, setCopiando] = useState(false)

  const [tAbierta, setTAbierta] = useState(false)
  const [tForm, setTForm] = useState({ nombre: '', formulario_id: '', ini: hoyLocal(), fin: '' })
  const [tError, setTError] = useState('')

  function flash(m: string) { setOk(m); setTimeout(() => setOk(''), 2600) }

  const cargarDia = useCallback(async () => {
    setCargando(true)
    let q = supabase.from('itinerario')
      .select('id,secuencia,hora_estimada,usuario:usuario_id(id,nombre),pdv:pdv_id(codigo,nombre,ciudad),tarea:tarea_id(nombre)')
      .eq('fecha_programada', fecha)
    if (cliente) q = q.eq('cliente_id', cliente)
    const { data } = await q
    const lista = ((data as any) ?? []) as Parada[]
    lista.sort((a, b) => (a.hora_estimada ?? '99').localeCompare(b.hora_estimada ?? '99'))
    setParadas(lista)
    setCargando(false)
  }, [fecha, cliente])

  const cargarTareas = useCallback(async () => {
    if (!cliente) { setTareas([]); return }
    const { data } = await supabase.from('tarea')
      .select('id,nombre,vigencia_ini,vigencia_fin,activa,formulario:formulario_id(nombre)')
      .eq('cliente_id', cliente).order('vigencia_ini', { ascending: false })
    setTareas((data as any) ?? [])
  }, [cliente])

  useEffect(() => {
    supabase.from('cliente').select('id,nombre').order('nombre').then(({ data }) => {
      setClientes(data ?? [])
      if (data?.length) setCliente(data[0].id)
    })
    supabase.from('usuario').select('id,nombre').eq('es_promotor', true).eq('activo', true)
      .order('nombre').then(({ data }) => setPromotores(data ?? []))
    supabase.from('pdv').select('id,codigo,nombre').eq('activo', true)
      .order('codigo').then(({ data }) => setPdvs(data ?? []))
  }, [])

  useEffect(() => { cargarDia() }, [cargarDia])
  useEffect(() => { cargarTareas() }, [cargarTareas])

  useEffect(() => {
    if (!cliente) { setFormularios([]); return }
    supabase.from('formulario').select('id,nombre').eq('cliente_id', cliente)
      .eq('activo', true).order('nombre').then(({ data }) => setFormularios(data ?? []))
  }, [cliente])

  // --- asignar ---------------------------------------------------------
  async function asignar(e: FormEvent) {
    e.preventDefault()
    setAviso('')
    const err: Record<string, string> = {}
    if (!form.usuario_id) err.usuario_id = 'Elige el promotor que hará la visita'
    if (!form.pdv_id) err.pdv_id = 'Elige el punto de venta'
    setErrores(err)
    if (Object.keys(err).length) return

    setGuardando(true)
    // la secuencia distingue dos visitas al mismo PDV en la misma fecha
    const { data: previas } = await supabase.from('itinerario').select('secuencia')
      .eq('usuario_id', form.usuario_id).eq('pdv_id', form.pdv_id).eq('fecha_programada', fecha)
    const sec = previas?.length ? Math.max(...previas.map(p => p.secuencia)) + 1 : 1

    const { error } = await supabase.from('itinerario').insert({
      cliente_id: cliente,
      usuario_id: form.usuario_id,
      pdv_id: form.pdv_id,
      tarea_id: form.tarea_id || null,
      fecha_programada: fecha,
      secuencia: sec,
      hora_estimada: form.hora || null,
    })
    setGuardando(false)

    if (error) {
      setAviso(error.code === '23505'
        ? 'Esa visita ya está programada para ese promotor.'
        : 'No se pudo asignar. ' + error.message)
      return
    }
    setAbierto(false)
    setForm({ ...form, pdv_id: '' })
    cargarDia()
    flash('Visita asignada')
  }

  async function quitar(id: string) {
    setAviso('')
    const { error } = await supabase.from('itinerario').delete().eq('id', id)
    if (error) { setAviso('No se pudo quitar. ' + error.message); return }
    cargarDia()
  }

  // --- copiar dia ------------------------------------------------------
  async function copiarDia() {
    setAviso('')
    if (!destino) { setAviso('Elige la fecha de destino antes de copiar.'); return }
    if (destino === fecha) { setAviso('La fecha de destino debe ser distinta.'); return }
    if (!paradas.length) { setAviso('Este día no tiene visitas que copiar.'); return }

    setCopiando(true)
    const { data: origen } = await supabase.from('itinerario')
      .select('cliente_id,usuario_id,pdv_id,tarea_id,secuencia,hora_estimada')
      .eq('fecha_programada', fecha).eq('cliente_id', cliente)

    const nuevas = (origen ?? []).map(o => ({ ...o, fecha_programada: destino }))
    const { error } = await supabase.from('itinerario').insert(nuevas)
    setCopiando(false)

    if (error) {
      setAviso(error.code === '23505'
        ? 'Esa fecha ya tiene algunas de estas visitas programadas.'
        : 'No se pudo copiar. ' + error.message)
      return
    }
    flash(`${nuevas.length} visitas copiadas al ${fechaLarga(destino)}`)
    setDestino('')
  }

  // --- tareas ----------------------------------------------------------
  async function crearTarea(e: FormEvent) {
    e.preventDefault()
    setTError('')
    if (!tForm.nombre.trim()) { setTError('Escribe un nombre para la tarea.'); return }
    if (!tForm.formulario_id) { setTError('Elige el formulario que se va a aplicar.'); return }
    if (!tForm.fin) { setTError('Indica hasta cuándo está vigente.'); return }
    if (tForm.fin < tForm.ini) { setTError('La fecha final no puede ser anterior a la inicial.'); return }

    const { error } = await supabase.from('tarea').insert({
      cliente_id: cliente,
      formulario_id: tForm.formulario_id,
      nombre: tForm.nombre.trim(),
      vigencia_ini: tForm.ini,
      vigencia_fin: tForm.fin,
    })
    if (error) { setTError('No se pudo crear. ' + error.message); return }
    setTAbierta(false)
    setTForm({ nombre: '', formulario_id: '', ini: hoyLocal(), fin: '' })
    cargarTareas()
    flash('Tarea creada')
  }

  // --- agrupado por promotor -------------------------------------------
  const porPromotor = promotores
    .map(p => ({ promotor: p, stops: paradas.filter(s => s.usuario?.id === p.id) }))
    .filter(g => g.stops.length)
  const sinRuta = promotores.filter(p => !paradas.some(s => s.usuario?.id === p.id))
  const vigentes = tareas.filter(t => t.activa && t.vigencia_fin >= fecha && t.vigencia_ini <= fecha)

  return (
    <>
      <div className="tope">
        <div>
          <h2 className="disp">Itinerarios</h2>
          <p style={{ textTransform: 'capitalize' }}>{fechaLarga(fecha)}</p>
        </div>
        {editable && (
          <button className="btn" onClick={() => { setAbierto(true); setErrores({}); setAviso('') }}>
            Asignar visita
          </button>
        )}
      </div>

      {aviso && <div className="aviso error" role="alert">{aviso}</div>}
      {ok && <div className="aviso ok" role="status">{ok}</div>}

      <div className="filtros">
        <div className="campo">
          <label htmlFor="f-fecha">Fecha</label>
          <input id="f-fecha" type="date" value={fecha} onChange={e => setFecha(e.target.value)} />
        </div>
        {clientes.length > 1 && (
          <div className="campo">
            <label htmlFor="f-cli">Cliente</label>
            <select id="f-cli" value={cliente} onChange={e => setCliente(e.target.value)}>
              {clientes.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </div>
        )}
      </div>

      <div className="resumen-dia">
        <div><b className="num">{paradas.length}</b>Visitas programadas</div>
        <div><b className="num">{porPromotor.length}</b>Promotores con ruta</div>
        <div><b className="num">{sinRuta.length}</b>Sin asignar</div>
        <div><b className="num">{vigentes.length}</b>Tareas vigentes</div>
      </div>

      {editable && paradas.length > 0 && (
        <div className="copiar">
          <label htmlFor="f-dest">Copiar esta ruta a la fecha</label>
          <input id="f-dest" type="date" value={destino} onChange={e => setDestino(e.target.value)} />
          <button type="button" onClick={copiarDia} disabled={copiando}>
            {copiando ? 'Copiando…' : 'Copiar'}
          </button>
        </div>
      )}

      {cargando ? (
        <div className="tabla"><p className="vacio">Cargando itinerario…</p></div>
      ) : paradas.length === 0 ? (
        <div className="tabla">
          <p className="vacio">
            No hay visitas programadas para este día.
            {editable ? ' Usa “Asignar visita” para agregar la primera.' : ''}
          </p>
        </div>
      ) : (
        porPromotor.map(g => (
          <section className="ruta" key={g.promotor.id}>
            <header>
              <b>{g.promotor.nombre}</b>
              <span>{g.stops.length} {g.stops.length === 1 ? 'parada' : 'paradas'}</span>
            </header>
            {g.stops.map((s, i) => (
              <div className="parada" key={s.id}>
                <span className="sec">{i + 1}</span>
                <span className="hr">{soloHora(s.hora_estimada)}</span>
                <span className="ds">
                  <b>{s.pdv?.codigo} · {s.pdv?.nombre}</b>
                  <span>{s.tarea?.nombre ?? 'Sin tarea asignada'}{s.pdv?.ciudad ? ' · ' + s.pdv.ciudad : ''}</span>
                </span>
                {editable && (
                  <button className="quitar" type="button" aria-label={'Quitar ' + s.pdv?.nombre}
                    onClick={() => quitar(s.id)}>✕</button>
                )}
              </div>
            ))}
          </section>
        ))
      )}

      {!cargando && sinRuta.length > 0 && (
        <p className="sinruta">
          <b>Sin ruta este día:</b> {sinRuta.map(p => p.nombre).join(', ')}.
        </p>
      )}

      {/* ---------------- tareas ---------------- */}
      <div className="tareas">
        <div className="tope">
          <div>
            <h2 className="disp">Tareas</h2>
            <p>Qué formulario se aplica y durante qué periodo</p>
          </div>
          {editable && (
            <button className="btn sec" onClick={() => { setTAbierta(true); setTError('') }}>
              Nueva tarea
            </button>
          )}
        </div>
        <div className="tabla">
          {tareas.length === 0 ? (
            <p className="vacio">Este cliente no tiene tareas registradas.</p>
          ) : (
            <table>
              <thead>
                <tr><th>Tarea</th><th>Formulario</th><th>Desde</th><th>Hasta</th><th>Estado</th></tr>
              </thead>
              <tbody>
                {tareas.map(t => {
                  const viva = t.activa && t.vigencia_fin >= fecha && t.vigencia_ini <= fecha
                  return (
                    <tr key={t.id}>
                      <td><b>{t.nombre}</b></td>
                      <td>{t.formulario?.nombre ?? '—'}</td>
                      <td className="num">{t.vigencia_ini}</td>
                      <td className="num">{t.vigencia_fin}</td>
                      <td>{viva
                        ? <span className="chip c-ok">VIGENTE</span>
                        : <span className="chip c-pen">FUERA DE VIGENCIA</span>}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* ---------------- panel asignar ---------------- */}
      {abierto && (
        <>
          <div className="velo" onClick={() => setAbierto(false)} />
          <div className="panel" role="dialog" aria-modal="true" aria-label="Asignar visita">
            <h3>Asignar visita</h3>
            <p style={{ fontSize: 13, color: 'var(--tinta-2)', margin: '-8px 0 16px', textTransform: 'capitalize' }}>
              {fechaLarga(fecha)}
            </p>
            <form onSubmit={asignar} noValidate>
              <div className={'campo' + (errores.usuario_id ? ' malo' : '')}>
                <label htmlFor="a-pro">Promotor</label>
                <select id="a-pro" value={form.usuario_id}
                  onChange={e => setForm({ ...form, usuario_id: e.target.value })}>
                  <option value="">Elige un promotor</option>
                  {promotores.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                </select>
                {errores.usuario_id && <span className="err">{errores.usuario_id}</span>}
              </div>

              <div className={'campo' + (errores.pdv_id ? ' malo' : '')}>
                <label htmlFor="a-pdv">Punto de venta</label>
                <select id="a-pdv" value={form.pdv_id}
                  onChange={e => setForm({ ...form, pdv_id: e.target.value })}>
                  <option value="">Elige una tienda</option>
                  {pdvs.map(p => (
                    <option key={p.id} value={p.id}>{p.codigo} — {p.nombre}</option>
                  ))}
                </select>
                {errores.pdv_id && <span className="err">{errores.pdv_id}</span>}
              </div>

              <div className="campo">
                <label htmlFor="a-tar">Tarea</label>
                <select id="a-tar" value={form.tarea_id}
                  onChange={e => setForm({ ...form, tarea_id: e.target.value })}>
                  <option value="">Sin tarea</option>
                  {vigentes.map(t => <option key={t.id} value={t.id}>{t.nombre}</option>)}
                </select>
                {vigentes.length === 0 && (
                  <span className="err" style={{ color: 'var(--tinta-2)' }}>
                    No hay tareas vigentes para esta fecha. La visita se puede asignar igual,
                    pero el promotor no tendrá formulario que contestar.
                  </span>
                )}
              </div>

              <div className="campo">
                <label htmlFor="a-hora">Hora estimada</label>
                <input id="a-hora" type="time" value={form.hora}
                  onChange={e => setForm({ ...form, hora: e.target.value })} />
              </div>

              <div className="dos" style={{ marginTop: 6 }}>
                <button type="button" className="btn sec" onClick={() => setAbierto(false)}>
                  Cancelar
                </button>
                <button className="btn" disabled={guardando}>
                  {guardando ? 'Asignando…' : 'Asignar'}
                </button>
              </div>
            </form>
          </div>
        </>
      )}

      {/* ---------------- panel tarea ---------------- */}
      {tAbierta && (
        <>
          <div className="velo" onClick={() => setTAbierta(false)} />
          <div className="panel" role="dialog" aria-modal="true" aria-label="Nueva tarea">
            <h3>Nueva tarea</h3>
            {tError && <div className="aviso error" role="alert">{tError}</div>}
            <form onSubmit={crearTarea} noValidate>
              <div className="campo">
                <label htmlFor="t-nom">Nombre</label>
                <input id="t-nom" value={tForm.nombre}
                  onChange={e => setTForm({ ...tForm, nombre: e.target.value })} />
              </div>
              <div className="campo">
                <label htmlFor="t-for">Formulario que se aplica</label>
                <select id="t-for" value={tForm.formulario_id}
                  onChange={e => setTForm({ ...tForm, formulario_id: e.target.value })}>
                  <option value="">Elige un formulario</option>
                  {formularios.map(f => <option key={f.id} value={f.id}>{f.nombre}</option>)}
                </select>
              </div>
              <div className="dos">
                <div className="campo">
                  <label htmlFor="t-ini">Vigente desde</label>
                  <input id="t-ini" type="date" value={tForm.ini}
                    onChange={e => setTForm({ ...tForm, ini: e.target.value })} />
                </div>
                <div className="campo">
                  <label htmlFor="t-fin">Hasta</label>
                  <input id="t-fin" type="date" value={tForm.fin}
                    onChange={e => setTForm({ ...tForm, fin: e.target.value })} />
                </div>
              </div>
              <div className="dos" style={{ marginTop: 6 }}>
                <button type="button" className="btn sec" onClick={() => setTAbierta(false)}>
                  Cancelar
                </button>
                <button className="btn">Crear tarea</button>
              </div>
            </form>
          </div>
        </>
      )}
    </>
  )
}
