import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useSesion, puede } from '../lib/sesion'

type Pdv = {
  id: string; codigo: string; nombre: string
  ciudad: string | null; estado: string | null
  lat: number | null; lng: number | null; radio_checkin: number
  cadena: { nombre: string } | null
  region: { nombre: string } | null
}
type Opcion = { id: string; nombre: string }

const vacio = {
  codigo: '', nombre: '', direccion: '', ciudad: '', estado: '',
  lat: '', lng: '', radio_checkin: '150', cadena_id: '', region_id: '',
}

export default function Pdvs() {
  const { perfil } = useSesion()
  const puedeEditar = puede(perfil, 'gestionar_catalogo')

  const [lista, setLista] = useState<Pdv[]>([])
  const [cadenas, setCadenas] = useState<Opcion[]>([])
  const [regiones, setRegiones] = useState<Opcion[]>([])
  const [cargando, setCargando] = useState(true)
  const [abierto, setAbierto] = useState(false)
  const [form, setForm] = useState({ ...vacio })
  const [errores, setErrores] = useState<Record<string, string>>({})
  const [aviso, setAviso] = useState('')
  const [guardando, setGuardando] = useState(false)

  async function cargar() {
    setCargando(true)
    const { data } = await supabase
      .from('pdv')
      .select('id,codigo,nombre,ciudad,estado,lat,lng,radio_checkin,cadena:cadena_id(nombre),region:region_id(nombre)')
      .order('codigo')
    setLista((data as any) ?? [])
    setCargando(false)
  }

  useEffect(() => {
    cargar()
    supabase.from('cadena').select('id,nombre').order('nombre')
      .then(({ data }) => setCadenas(data ?? []))
    supabase.from('region').select('id,nombre').order('nombre')
      .then(({ data }) => setRegiones(data ?? []))
  }, [])

  function validar() {
    const e: Record<string, string> = {}
    if (!form.codigo.trim()) e.codigo = 'Escribe un código, por ejemplo PDV-004'
    if (!form.nombre.trim()) e.nombre = 'Escribe el nombre de la tienda'

    const lat = parseFloat(form.lat), lng = parseFloat(form.lng)
    if (form.lat && (isNaN(lat) || lat < -90 || lat > 90))
      e.lat = 'La latitud va de -90 a 90. En México ronda 19 a 32'
    if (form.lng && (isNaN(lng) || lng < -180 || lng > 180))
      e.lng = 'La longitud va de -180 a 180. En México ronda -86 a -118'

    const radio = parseInt(form.radio_checkin)
    if (isNaN(radio) || radio < 20 || radio > 2000)
      e.radio_checkin = 'Usa un radio entre 20 y 2000 metros'

    setErrores(e)
    return Object.keys(e).length === 0
  }

  async function guardar(ev: FormEvent) {
    ev.preventDefault()
    setAviso('')
    if (!validar()) return

    setGuardando(true)
    const { data: yo } = await supabase
      .from('usuario').select('organizacion_id')
      .eq('id', (await supabase.auth.getUser()).data.user?.id ?? '')
      .maybeSingle()

    const { error } = await supabase.from('pdv').insert({
      organizacion_id: yo?.organizacion_id,
      codigo: form.codigo.trim(),
      nombre: form.nombre.trim(),
      direccion: form.direccion.trim() || null,
      ciudad: form.ciudad.trim() || null,
      estado: form.estado.trim() || null,
      lat: form.lat ? parseFloat(form.lat) : null,
      lng: form.lng ? parseFloat(form.lng) : null,
      radio_checkin: parseInt(form.radio_checkin),
      cadena_id: form.cadena_id || null,
      region_id: form.region_id || null,
    })
    setGuardando(false)

    if (error) {
      setAviso(
        error.code === '23505'
          ? 'Ya existe un punto de venta con ese código. Usa uno distinto.'
          : 'No se pudo guardar. ' + error.message
      )
      return
    }
    setAbierto(false)
    setForm({ ...vacio })
    cargar()
  }

  const campo = (
    llave: keyof typeof vacio, etiqueta: string,
    tipo: 'text' | 'number' = 'text', paso?: string
  ) => (
    <div className={'campo' + (errores[llave] ? ' malo' : '')}>
      <label htmlFor={llave}>{etiqueta}</label>
      <input
        id={llave} type={tipo} step={paso} value={form[llave]}
        onChange={e => setForm({ ...form, [llave]: e.target.value })}
        aria-describedby={errores[llave] ? llave + '-err' : undefined}
      />
      {errores[llave] && <span className="err" id={llave + '-err'}>{errores[llave]}</span>}
    </div>
  )

  return (
    <>
      <div className="tope">
        <div>
          <h2 className="disp">Puntos de venta</h2>
          <p>{cargando ? 'Cargando…' : `${lista.length} registrados`}</p>
        </div>
        {puedeEditar && (
          <button className="btn" onClick={() => { setAbierto(true); setAviso(''); setErrores({}) }}>
            Nuevo punto de venta
          </button>
        )}
      </div>

      <div className="tabla">
        {cargando ? (
          <p className="vacio">Cargando puntos de venta…</p>
        ) : lista.length === 0 ? (
          <p className="vacio">
            Todavía no hay puntos de venta.
            {puedeEditar ? ' Da de alta el primero con el botón de arriba.' : ''}
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Código</th><th>Nombre</th><th>Cadena</th>
                <th>Ciudad</th><th>Región</th><th>Radio</th>
              </tr>
            </thead>
            <tbody>
              {lista.map(p => (
                <tr key={p.id}>
                  <td className="num"><b>{p.codigo}</b></td>
                  <td>{p.nombre}</td>
                  <td>{p.cadena?.nombre ?? '—'}</td>
                  <td>{p.ciudad ?? '—'}</td>
                  <td>{p.region?.nombre ?? '—'}</td>
                  <td className="num">{p.radio_checkin} m</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {abierto && (
        <>
          <div className="velo" onClick={() => setAbierto(false)} />
          <div className="panel" role="dialog" aria-modal="true" aria-label="Nuevo punto de venta">
            <h3>Nuevo punto de venta</h3>
            {aviso && <div className="aviso error" role="alert">{aviso}</div>}
            <form onSubmit={guardar} noValidate>
              <div className="dos">
                {campo('codigo', 'Código')}
                {campo('radio_checkin', 'Radio de check-in (m)', 'number')}
              </div>
              {campo('nombre', 'Nombre de la tienda')}

              <div className="campo">
                <label htmlFor="cadena_id">Cadena</label>
                <select id="cadena_id" value={form.cadena_id}
                  onChange={e => setForm({ ...form, cadena_id: e.target.value })}>
                  <option value="">Sin cadena</option>
                  {cadenas.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                </select>
              </div>

              <div className="campo">
                <label htmlFor="region_id">Región</label>
                <select id="region_id" value={form.region_id}
                  onChange={e => setForm({ ...form, region_id: e.target.value })}>
                  <option value="">Sin región</option>
                  {regiones.map(r => <option key={r.id} value={r.id}>{r.nombre}</option>)}
                </select>
              </div>

              {campo('direccion', 'Dirección')}
              <div className="dos">
                {campo('ciudad', 'Ciudad')}
                {campo('estado', 'Estado')}
              </div>
              <div className="dos">
                {campo('lat', 'Latitud', 'number', 'any')}
                {campo('lng', 'Longitud', 'number', 'any')}
              </div>

              <div className="dos" style={{ marginTop: 6 }}>
                <button type="button" className="btn sec" onClick={() => setAbierto(false)}>
                  Cancelar
                </button>
                <button className="btn" disabled={guardando}>
                  {guardando ? 'Guardando…' : 'Guardar'}
                </button>
              </div>
            </form>
          </div>
        </>
      )}
    </>
  )
}
