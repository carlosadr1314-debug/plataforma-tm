import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useSesion, puede } from '../lib/sesion'

type Form = {
  id: string; nombre: string; descripcion: string | null
  es_plantilla: boolean; version: number; activo: boolean
  cliente: { nombre: string } | null
  pregunta: { count: number }[]
}

export default function Formularios() {
  const { perfil } = useSesion()
  const editable = puede(perfil, 'crear_formularios')
  // Armar formularios y sacarlos de circulacion son decisiones
  // distintas: lo segundo afecta a quien ya los esta usando en campo.
  const puedeDesactivar = puede(perfil, 'admin')
  const ir = useNavigate()

  const [lista, setLista] = useState<Form[]>([])
  const [cargando, setCargando] = useState(true)
  const [abierto, setAbierto] = useState(false)
  const [nombre, setNombre] = useState('')
  const [desc, setDesc] = useState('')
  const [plantilla, setPlantilla] = useState(false)
  const [clientes, setClientes] = useState<{ id: string; nombre: string }[]>([])
  const [cliente, setCliente] = useState('')
  const [error, setError] = useState('')
  const [cambiando, setCambiando] = useState<string | null>(null)
  // El error de la lista va aparte del de los paneles: ese solo se ve
  // con un panel abierto, y esto pasa en la tabla.
  const [avisoLista, setAvisoLista] = useState('')
  const [guardando, setGuardando] = useState(false)

  // Clonar una plantilla: hasta ahora se podia marcar un formulario
  // como plantilla pero no habia forma de usarla, que es para lo
  // unico que sirve serlo.
  const [clonando, setClonando] = useState<null | { id: string; nombre: string }>(null)
  const [destino, setDestino] = useState({ cliente: '', nombre: '' })
  const [copiando, setCopiando] = useState(false)

  function abrirClonado(f: { id: string; nombre: string }) {
    setError('')
    setClonando(f)
    setDestino({ cliente: clientes[0]?.id ?? '', nombre: f.nombre })
  }

  async function clonar(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (!clonando) return
    if (!destino.cliente) { setError('Elige para qué cliente es.'); return }
    if (!destino.nombre.trim()) { setError('Ponle un nombre al formulario.'); return }

    setCopiando(true)
    const { data, error: err } = await supabase.rpc('clonar_formulario', {
      p_origen: clonando.id,
      p_cliente: destino.cliente,
      p_nombre: destino.nombre.trim(),
    })
    setCopiando(false)
    if (err) { setError('No se pudo copiar. ' + err.message); return }
    setClonando(null)
    // Se abre de una vez para recortar lo que no aplique.
    ir(`/formularios/${data}`)
  }

  /**
   * Saca de circulacion un formulario, o lo regresa. No borra nada: lo
   * ya capturado con el se sigue consultando igual. Pasa por una
   * funcion de la base porque pide permiso de administrador, que no es
   * el mismo que el de armar formularios.
   */
  async function cambiarActivo(f: Form) {
    setAvisoLista('')
    setCambiando(f.id)
    const { error: err } = await supabase.rpc('fijar_formulario_activo', {
      p_formulario: f.id,
      p_activo: !f.activo,
    })
    setCambiando(null)

    if (err) {
      setAvisoLista(err.message.includes('administrador')
        ? 'Desactivar formularios es cosa de administradores.'
        : 'No se pudo cambiar. ' + err.message)
      return
    }
    setAvisoLista(f.activo
      ? `"${f.nombre}" queda fuera de circulación. No se borró nada: lo ya ` +
        'capturado con él se sigue consultando.'
      : `"${f.nombre}" vuelve a estar disponible.`)
    cargar()
  }

  async function cargar() {
    setCargando(true)
    const { data } = await supabase.from('formulario')
      .select('id,nombre,descripcion,es_plantilla,version,activo,cliente:cliente_id(nombre),pregunta(count)')
      .order('es_plantilla', { ascending: false }).order('nombre')
    setLista((data as any) ?? [])
    setCargando(false)
  }

  useEffect(() => {
    cargar()
    supabase.from('cliente').select('id,nombre').order('nombre').then(({ data }) => {
      setClientes(data ?? [])
      if (data?.length) setCliente(data[0].id)
    })
  }, [])

  async function crear(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (!nombre.trim()) { setError('Escribe un nombre para el formulario.'); return }
    if (!plantilla && !cliente) { setError('Elige el cliente al que pertenece.'); return }

    setGuardando(true)
    const { data: yo } = await supabase.from('usuario')
      .select('organizacion_id').eq('id', (await supabase.auth.getUser()).data.user?.id ?? '')
      .maybeSingle()

    const { data, error: err } = await supabase.from('formulario').insert({
      organizacion_id: yo?.organizacion_id,
      cliente_id: plantilla ? null : cliente,
      es_plantilla: plantilla,
      nombre: nombre.trim(),
      descripcion: desc.trim() || null,
    }).select('id').single()
    setGuardando(false)

    if (err) { setError('No se pudo crear. ' + err.message); return }
    ir(`/formularios/${data!.id}`)
  }

  return (
    <>
      <div className="tope">
        <div>
          <h2 className="disp">Formularios</h2>
          <p>{cargando ? 'Cargando…' : `${lista.length} registrados`}</p>
        </div>
        {editable && (
          <button className="btn" onClick={() => { setAbierto(true); setError('') }}>
            Nuevo formulario
          </button>
        )}
      </div>

      {avisoLista !== '' && (
        <div className="aviso ojo" role="status">{avisoLista}</div>
      )}

      <div className="tabla">
        {cargando ? <p className="vacio">Cargando formularios…</p>
          : lista.length === 0 ? (
            <p className="vacio">
              Todavia no hay formularios.
              {editable ? ' Crea el primero con el boton de arriba.' : ''}
            </p>
          ) : (
            <table>
              <thead>
                <tr><th>Nombre</th><th>Pertenece a</th><th>Preguntas</th>
                    <th>Version</th><th>Estado</th><th></th></tr>
              </thead>
              <tbody>
                {lista.map(f => (
                  <tr key={f.id}>
                    <td>
                      <b>{f.nombre}</b>
                      {f.descripcion && (
                        <><br /><span style={{ color: 'var(--tinta-2)', fontSize: 11.5 }}>
                          {f.descripcion}</span></>
                      )}
                    </td>
                    <td>{f.es_plantilla
                      ? <span className="chip c-cur">PLANTILLA</span>
                      : (f.cliente?.nombre ?? '—')}</td>
                    <td className="num">{f.pregunta?.[0]?.count ?? 0}</td>
                    <td className="num">v{f.version}</td>
                    <td>{f.activo
                      ? <span className="chip c-ok">ACTIVO</span>
                      : <span className="chip c-pen">INACTIVO</span>}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {editable && f.es_plantilla && (
                        <button className="btn" style={{ minHeight: 38, fontSize: 14, marginRight: 6 }}
                          onClick={() => abrirClonado(f)}>
                          Usar plantilla
                        </button>
                      )}
                      {puedeDesactivar && (
                        <button className="btn sec"
                          style={{ minHeight: 38, fontSize: 14, marginRight: 6 }}
                          disabled={cambiando === f.id}
                          onClick={() => cambiarActivo(f)}>
                          {cambiando === f.id ? '…' : f.activo ? 'Desactivar' : 'Activar'}
                        </button>
                      )}
                      <button className="btn sec" style={{ minHeight: 38, fontSize: 14 }}
                        onClick={() => ir(`/formularios/${f.id}`)}>
                        {editable ? 'Editar' : 'Ver'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </div>

      {avisoLista !== '' && (
        <div className="aviso ojo" role="status">{avisoLista}</div>
      )}

      {clonando && (
        <>
          <div className="velo" onClick={() => setClonando(null)} />
          <div className="panel" role="dialog" aria-modal="true" aria-label="Usar plantilla">
            <h3>Usar plantilla</h3>
            {error && <div className="aviso error" role="alert">{error}</div>}
            <form onSubmit={clonar} noValidate>
              <p className="nota-panel" style={{ marginTop: 0 }}>
                Se copia <strong>{clonando.nombre}</strong> completa —preguntas,
                opciones y condiciones— para el cliente que elijas. La plantilla
                original no se toca.
              </p>

              <div className="campo">
                <label htmlFor="cl-dest">Cliente</label>
                <select id="cl-dest" value={destino.cliente}
                        onChange={ev => setDestino({ ...destino, cliente: ev.target.value })}>
                  <option value="">Elige un cliente</option>
                  {clientes.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                </select>
              </div>

              <div className="campo">
                <label htmlFor="nom-dest">Nombre del formulario</label>
                <input id="nom-dest" value={destino.nombre}
                       onChange={ev => setDestino({ ...destino, nombre: ev.target.value })} />
              </div>

              <p className="nota-panel">
                Al guardar se abre para que recortes lo que no aplique. La
                plantilla trae veinticinco preguntas a propósito: está pensada
                para quitarle, no para usarse entera.
              </p>

              <div className="dos" style={{ marginTop: 6 }}>
                <button type="button" className="btn sec" onClick={() => setClonando(null)}>
                  Cancelar
                </button>
                <button className="btn" disabled={copiando}>
                  {copiando ? 'Copiando…' : 'Crear formulario'}
                </button>
              </div>
            </form>
          </div>
        </>
      )}

      {abierto && (
        <>
          <div className="velo" onClick={() => setAbierto(false)} />
          <div className="panel" role="dialog" aria-modal="true" aria-label="Nuevo formulario">
            <h3>Nuevo formulario</h3>
            {error && <div className="aviso error" role="alert">{error}</div>}
            <form onSubmit={crear} noValidate>
              <div className="campo">
                <label htmlFor="nf">Nombre</label>
                <input id="nf" value={nombre} onChange={e => setNombre(e.target.value)} />
              </div>
              <div className="campo">
                <label htmlFor="df">Descripcion</label>
                <input id="df" value={desc} onChange={e => setDesc(e.target.value)} />
              </div>
              <div className="sw">
                <span>Es plantilla estandar</span>
                <button type="button" aria-pressed={plantilla}
                  aria-label="Es plantilla estandar"
                  onClick={() => setPlantilla(!plantilla)}><span /></button>
              </div>
              {!plantilla && (
                <div className="campo">
                  <label htmlFor="cf">Cliente</label>
                  <select id="cf" value={cliente} onChange={e => setCliente(e.target.value)}>
                    {clientes.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                  </select>
                </div>
              )}
              <p style={{ fontSize: 12.5, color: 'var(--tinta-2)', margin: '0 0 14px' }}>
                Una plantilla vive a nivel de la organizacion y sirve de base
                para todos los clientes. Un formulario normal pertenece a una marca.
              </p>
              <div className="dos">
                <button type="button" className="btn sec" onClick={() => setAbierto(false)}>
                  Cancelar
                </button>
                <button className="btn" disabled={guardando}>
                  {guardando ? 'Creando…' : 'Crear y editar'}
                </button>
              </div>
            </form>
          </div>
        </>
      )}
    </>
  )
}
