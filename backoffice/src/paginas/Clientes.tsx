import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useSesion, puede } from '../lib/sesion'

// =====================================================================
// Clientes, regiones y cadenas
//
// Son las tres listas de las que cuelga todo lo demas: sin un cliente
// no hay catalogo ni formularios, y sin region ni cadena no se puede
// dar de alta un punto de venta. Hasta ahora solo se leian en los
// desplegables y no habia forma de crearlas, asi que una empresa
// recien dada de alta se quedaba sin poder hacer nada.
//
// Que son, en los terminos de la operacion:
//   · Cliente — la marca a la que se le da servicio (quien paga)
//   · Region  — la zona en que se reparte el territorio
//   · Cadena  — el autoservicio dueno de la tienda
//
// El cliente se desactiva, no se borra: las visitas y la evidencia
// apuntan a el y borrarlo rompe el historial. Region y cadena si se
// pueden borrar mientras nadie las use, porque un nombre mal escrito
// ahi no arrastra historia.
// =====================================================================

type Fila = { id: string; nombre: string; activo?: boolean }
type Cual = 'cliente' | 'region' | 'cadena'

const TITULO: Record<Cual, string> = {
  cliente: 'Clientes', region: 'Regiones', cadena: 'Cadenas',
}
const UNO: Record<Cual, string> = {
  cliente: 'cliente', region: 'región', cadena: 'cadena',
}
const PISTA: Record<Cual, string> = {
  cliente: 'La marca a la que le das servicio. De aquí cuelgan el catálogo y los formularios.',
  region: 'La zona en que repartes el territorio. Se le asigna a cada punto de venta y a cada promotor.',
  cadena: 'El autoservicio dueño de la tienda: Walmart, Soriana, Chedraui.',
}

export default function Clientes() {
  const { perfil } = useSesion()
  const editable = puede(perfil, 'admin')

  const [listas, setListas] = useState<Record<Cual, Fila[]>>(
    { cliente: [], region: [], cadena: [] })
  const [organizacion, setOrganizacion] = useState('')
  const [cargando, setCargando] = useState(true)
  const [verInactivos, setVerInactivos] = useState(false)

  const [aviso, setAviso] = useState('')
  const [ok, setOk] = useState('')
  const flash = (m: string) => { setOk(m); setTimeout(() => setOk(''), 2600) }

  // Alta en linea, al pie de cada columna.
  const [nuevo, setNuevo] = useState<Cual | null>(null)
  const [texto, setTexto] = useState('')

  // Edicion en panel, como en el catalogo.
  const [editando, setEditando] = useState<null | { cual: Cual; fila: Fila }>(null)
  const [form, setForm] = useState({ nombre: '', activo: true })
  const [guardando, setGuardando] = useState(false)

  async function cargar() {
    setCargando(true)
    const [cl, re, ca] = await Promise.all([
      supabase.from('cliente').select('id,nombre,activo').order('nombre'),
      supabase.from('region').select('id,nombre').order('nombre'),
      supabase.from('cadena').select('id,nombre').order('nombre'),
    ])
    setListas({
      cliente: (cl.data as Fila[]) ?? [],
      region: (re.data as Fila[]) ?? [],
      cadena: (ca.data as Fila[]) ?? [],
    })
    setCargando(false)
  }

  useEffect(() => {
    cargar()
    ;(async () => {
      const { data: u } = await supabase.auth.getUser()
      if (!u.user) return
      const { data } = await supabase.from('usuario')
        .select('organizacion_id').eq('id', u.user.id).maybeSingle()
      if (data) setOrganizacion(data.organizacion_id)
    })()
  }, [])

  // Postgres contesta con la restriccion que se violo; aqui se
  // traduce a algo que le sirva a quien esta en la pantalla.
  function explicar(mensaje: string, cual: Cual) {
    const m = mensaje.toLowerCase()
    if (m.includes('duplicate') || m.includes('unique'))
      return `Ya tienes ${UNO[cual] === 'región' ? 'una región' : 'un ' + UNO[cual]} con ese nombre.`
    if (m.includes('foreign key') || m.includes('violates'))
      return cual === 'region'
        ? 'No se puede borrar: hay puntos de venta o usuarios en esta región.'
        : 'No se puede borrar: hay puntos de venta de esta cadena.'
    if (m.includes('row-level security') || m.includes('policy'))
      return 'Tu perfil no tiene permiso para esto. Lo hace un administrador.'
    return mensaje
  }

  async function agregar(e: FormEvent, cual: Cual) {
    e.preventDefault()
    setAviso('')
    const nombre = texto.trim()
    if (!nombre) { setAviso(`Escribe el nombre de la ${UNO[cual]}.`); return }
    if (!organizacion) { setAviso('Todavía estoy leyendo tu empresa. Espera un segundo.'); return }

    const { error } = await supabase.from(cual)
      .insert({ organizacion_id: organizacion, nombre })
    if (error) { setAviso(explicar(error.message, cual)); return }

    setTexto('')
    setNuevo(null)
    flash(`${nombre} agregado`)
    cargar()
  }

  function abrirEdicion(cual: Cual, fila: Fila) {
    setAviso('')
    setEditando({ cual, fila })
    setForm({ nombre: fila.nombre, activo: fila.activo ?? true })
  }

  async function guardar(e: FormEvent) {
    e.preventDefault()
    if (!editando) return
    const nombre = form.nombre.trim()
    if (!nombre) { setAviso('El nombre no puede quedar vacío.'); return }

    setGuardando(true)
    const cambios: Record<string, unknown> = { nombre }
    if (editando.cual === 'cliente') cambios.activo = form.activo

    const { error } = await supabase.from(editando.cual)
      .update(cambios).eq('id', editando.fila.id)
    setGuardando(false)
    if (error) { setAviso(explicar(error.message, editando.cual)); return }

    setEditando(null)
    flash('Cambios guardados')
    cargar()
  }

  async function borrar() {
    if (!editando || editando.cual === 'cliente') return
    setGuardando(true)
    const { error } = await supabase.from(editando.cual)
      .delete().eq('id', editando.fila.id)
    setGuardando(false)
    if (error) { setAviso(explicar(error.message, editando.cual)); return }

    setEditando(null)
    flash('Eliminado')
    cargar()
  }

  const visibles = (cual: Cual) =>
    cual === 'cliente' && !verInactivos
      ? listas.cliente.filter(f => f.activo)
      : listas[cual]

  function columna(cual: Cual) {
    const filas = visibles(cual)
    const ocultas = listas[cual].length - filas.length
    return (
      <section className="col" key={cual}>
        <header><h3>{TITULO[cual]}</h3><span>{filas.length}</span></header>

        <p className="pista-col">{PISTA[cual]}</p>

        <ul>
          {filas.map(f => (
            <li key={f.id} className={f.activo === false ? 'inactiva' : ''}>
              <div className="fila-cat">
                <span className="nombre-fijo">
                  {f.nombre}
                  {f.activo === false && <em>inactivo</em>}
                </span>
                {editable && (
                  <button className="ed" onClick={() => abrirEdicion(cual, f)}
                          aria-label={'Editar ' + f.nombre}>Editar</button>
                )}
              </div>
            </li>
          ))}
        </ul>

        {filas.length === 0 && (
          <p className="sinnada">
            {ocultas > 0
              ? `Ninguno activo. Hay ${ocultas} inactivo${ocultas > 1 ? 's' : ''}.`
              : `Sin ${TITULO[cual].toLowerCase()}.${editable ? ' Agrega el primero abajo.' : ''}`}
          </p>
        )}

        {editable && (nuevo === cual ? (
          <form className="nuevo" onSubmit={e => agregar(e, cual)}>
            <input autoFocus value={texto} onChange={e => setTexto(e.target.value)}
                   placeholder={'Nombre de la ' + UNO[cual]}
                   aria-label={'Nombre de la ' + UNO[cual]} />
            <button>Guardar</button>
            <button type="button" className="x" aria-label="Cancelar"
                    onClick={() => { setNuevo(null); setTexto('') }}>✕</button>
          </form>
        ) : (
          <footer>
            <button className="agregar"
                    onClick={() => { setAviso(''); setTexto(''); setNuevo(cual) }}>
              + Agregar {UNO[cual]}
            </button>
          </footer>
        ))}
      </section>
    )
  }

  return (
    <>
      <div className="tope">
        <div>
          <h2 className="disp">Clientes</h2>
          <p>Clientes, regiones y cadenas</p>
        </div>
        <div className="tope-dcha">
          <label className="chk">
            <input type="checkbox" checked={verInactivos}
                   onChange={e => setVerInactivos(e.target.checked)} />
            Ver inactivos
          </label>
        </div>
      </div>

      {aviso && <div className="aviso error" role="alert">{aviso}</div>}
      {ok && <div className="aviso ok" role="status">{ok}</div>}

      {!editable && (
        <div className="aviso" style={{ background: 'var(--arena)', border: '1px solid var(--borde)' }}>
          Puedes ver estas listas pero no cambiarlas. Las administra un administrador.
        </div>
      )}

      {cargando
        ? <p className="sinnada">Cargando…</p>
        : <div className="cols iguales">{(['cliente', 'region', 'cadena'] as Cual[]).map(columna)}</div>}

      {editando && (
        <>
          <div className="velo" onClick={() => setEditando(null)} />
          <div className="panel" role="dialog" aria-modal="true"
               aria-label={'Editar ' + UNO[editando.cual]}>
            <h3>Editar {UNO[editando.cual]}</h3>
            <form onSubmit={guardar} noValidate>
              <div className="campo">
                <label htmlFor="ed-nombre">Nombre</label>
                <input id="ed-nombre" autoFocus value={form.nombre}
                       onChange={e => setForm({ ...form, nombre: e.target.value })} />
              </div>

              {editando.cual === 'cliente' && (
                <>
                  <label className="chk" style={{ marginBottom: 6 }}>
                    <input type="checkbox" checked={form.activo}
                           onChange={e => setForm({ ...form, activo: e.target.checked })} />
                    Activo
                  </label>
                  <p className="nota-panel">
                    Al desactivarlo deja de ofrecerse al crear formularios, rutas y
                    productos. Lo que ya se capturó no se toca.
                  </p>
                </>
              )}

              {editando.cual !== 'cliente' && (
                <p className="nota-panel">
                  Si ya nadie la usa puedes eliminarla. Si hay puntos de venta o
                  promotores asignados, cámbiale el nombre en vez de borrarla.
                </p>
              )}

              <div className="dos" style={{ marginTop: 6 }}>
                <button type="button" className="btn sec"
                        onClick={() => setEditando(null)}>Cancelar</button>
                <button className="btn" disabled={guardando}>
                  {guardando ? 'Guardando…' : 'Guardar'}
                </button>
              </div>

              {editando.cual !== 'cliente' && (
                <button type="button" className="borrar" disabled={guardando}
                        onClick={borrar}>
                  Eliminar {UNO[editando.cual]}
                </button>
              )}
            </form>
          </div>
        </>
      )}
    </>
  )
}
