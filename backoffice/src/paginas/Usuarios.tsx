import { useEffect, useState, useCallback, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useSesion, puede } from '../lib/sesion'

type Fila = { id: string; nombre: string }
type Usuario = {
  id: string; nombre: string; telefono: string | null
  es_promotor: boolean; es_admin_raiz: boolean; activo: boolean
  perfil: Fila | null
  region: Fila | null
}
type Pendiente = { id: string; correo: string; creado: string }

const vacio = {
  nombre: '', telefono: '', perfil_id: '', region_id: '',
  es_promotor: false, activo: true,
}

export default function Usuarios() {
  const { perfil: yo } = useSesion()
  const editable = puede(yo, 'admin')

  const [usuarios, setUsuarios] = useState<Usuario[]>([])
  const [perfiles, setPerfiles] = useState<Fila[]>([])
  const [regiones, setRegiones] = useState<Fila[]>([])
  const [clientes, setClientes] = useState<Fila[]>([])
  const [asignados, setAsignados] = useState<Record<string, string[]>>({})
  const [cargando, setCargando] = useState(true)

  const [aviso, setAviso] = useState('')
  const [ok, setOk] = useState('')

  const [editando, setEditando] = useState<Usuario | null>(null)
  const [form, setForm] = useState({ ...vacio })
  const [misClientes, setMisClientes] = useState<string[]>([])
  const [guardando, setGuardando] = useState(false)

  const [altaAbierta, setAltaAbierta] = useState(false)
  const [pendientes, setPendientes] = useState<Pendiente[]>([])
  const [cuenta, setCuenta] = useState('')

  function flash(m: string) { setOk(m); setTimeout(() => setOk(''), 2600) }

  const cargar = useCallback(async () => {
    setCargando(true)
    const { data: us } = await supabase.from('usuario')
      .select('id,nombre,telefono,es_promotor,es_admin_raiz,activo,perfil:perfil_id(id,nombre),region:region_id(id,nombre)')
      .order('nombre')
    setUsuarios((us as any) ?? [])

    const { data: uc } = await supabase.from('usuario_cliente').select('usuario_id,cliente_id')
    const mapa: Record<string, string[]> = {}
    ;(uc ?? []).forEach(r => {
      (mapa[r.usuario_id] ??= []).push(r.cliente_id)
    })
    setAsignados(mapa)
    setCargando(false)
  }, [])

  useEffect(() => {
    cargar()
    supabase.from('perfil').select('id,nombre').order('nombre')
      .then(({ data }) => setPerfiles(data ?? []))
    supabase.from('region').select('id,nombre').order('nombre')
      .then(({ data }) => setRegiones(data ?? []))
    supabase.from('cliente').select('id,nombre').order('nombre')
      .then(({ data }) => setClientes(data ?? []))
  }, [cargar])

  function abrirEdicion(u: Usuario) {
    setAviso('')
    setEditando(u)
    setForm({
      nombre: u.nombre,
      telefono: u.telefono ?? '',
      perfil_id: u.perfil?.id ?? '',
      region_id: u.region?.id ?? '',
      es_promotor: u.es_promotor,
      activo: u.activo,
    })
    setMisClientes(asignados[u.id] ?? [])
  }

  async function sincronizarClientes(usuarioId: string, previos: string[], nuevos: string[]) {
    const quitar = previos.filter(c => !nuevos.includes(c))
    const poner = nuevos.filter(c => !previos.includes(c))
    for (const c of quitar) {
      await supabase.from('usuario_cliente').delete()
        .eq('usuario_id', usuarioId).eq('cliente_id', c)
    }
    if (poner.length) {
      await supabase.from('usuario_cliente')
        .insert(poner.map(c => ({ usuario_id: usuarioId, cliente_id: c })))
    }
  }

  async function guardar(e: FormEvent) {
    e.preventDefault()
    setAviso('')
    if (!editando) return
    if (!form.nombre.trim()) { setAviso('Escribe el nombre de la persona.'); return }
    if (!form.perfil_id) { setAviso('Elige un perfil.'); return }

    setGuardando(true)
    const { error } = await supabase.from('usuario').update({
      nombre: form.nombre.trim(),
      telefono: form.telefono.trim() || null,
      perfil_id: form.perfil_id,
      region_id: form.region_id || null,
      es_promotor: form.es_promotor,
      activo: form.activo,
    }).eq('id', editando.id)

    if (error) {
      setGuardando(false)
      setAviso(error.message.includes('administrador raiz')
        ? 'El administrador raíz no se puede modificar desde aquí.'
        : 'No se pudo guardar. ' + error.message)
      return
    }

    await sincronizarClientes(editando.id, asignados[editando.id] ?? [], misClientes)
    setGuardando(false)
    setEditando(null)
    cargar()
    flash('Usuario actualizado')
  }

  async function abrirAlta() {
    setAviso('')
    setCuenta('')
    setForm({ ...vacio })
    setMisClientes([])
    const { data, error } = await supabase.rpc('usuarios_sin_perfil')
    if (error) {
      setAviso('No se pudieron consultar las cuentas pendientes. ' + error.message)
    }
    setPendientes((data as any) ?? [])
    setAltaAbierta(true)
  }

  async function darAlta(e: FormEvent) {
    e.preventDefault()
    setAviso('')
    if (!cuenta) { setAviso('Elige la cuenta a la que vas a dar perfil.'); return }
    if (!form.nombre.trim()) { setAviso('Escribe el nombre de la persona.'); return }
    if (!form.perfil_id) { setAviso('Elige un perfil.'); return }

    setGuardando(true)
    const { data: mio } = await supabase.from('usuario')
      .select('organizacion_id').eq('id', (await supabase.auth.getUser()).data.user?.id ?? '')
      .maybeSingle()

    const { error } = await supabase.from('usuario').insert({
      id: cuenta,
      organizacion_id: mio?.organizacion_id,
      perfil_id: form.perfil_id,
      region_id: form.region_id || null,
      nombre: form.nombre.trim(),
      telefono: form.telefono.trim() || null,
      es_promotor: form.es_promotor,
      activo: form.activo,
    })

    if (error) {
      setGuardando(false)
      setAviso('No se pudo dar de alta. ' + error.message)
      return
    }
    await sincronizarClientes(cuenta, [], misClientes)
    setGuardando(false)
    setAltaAbierta(false)
    cargar()
    flash('Usuario dado de alta')
  }

  const nombresClientes = (id: string) => {
    const lista = (asignados[id] ?? [])
      .map(c => clientes.find(x => x.id === c)?.nombre)
      .filter(Boolean)
    return lista.length ? lista.join(', ') : '—'
  }

  const camposComunes = (
    <>
      <div className="campo">
        <label htmlFor="u-nom">Nombre</label>
        <input id="u-nom" value={form.nombre}
          onChange={e => setForm({ ...form, nombre: e.target.value })} />
      </div>
      <div className="campo">
        <label htmlFor="u-tel">Teléfono</label>
        <input id="u-tel" value={form.telefono}
          onChange={e => setForm({ ...form, telefono: e.target.value })} />
      </div>
      <div className="campo">
        <label htmlFor="u-per">Perfil</label>
        <select id="u-per" value={form.perfil_id}
          onChange={e => setForm({ ...form, perfil_id: e.target.value })}>
          <option value="">Elige un perfil</option>
          {perfiles.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
        </select>
      </div>
      <div className="campo">
        <label htmlFor="u-reg">Región</label>
        <select id="u-reg" value={form.region_id}
          onChange={e => setForm({ ...form, region_id: e.target.value })}>
          <option value="">Sin restricción territorial</option>
          {regiones.map(r => <option key={r.id} value={r.id}>{r.nombre}</option>)}
        </select>
      </div>
      <p className="nota-panel">
        Sin región, la persona ve todos los puntos de venta de la organización.
        Con región, solo los de esa zona.
      </p>

      <div className="sw">
        <span>Trabaja en campo</span>
        <button type="button" aria-pressed={form.es_promotor} aria-label="Trabaja en campo"
          onClick={() => setForm({ ...form, es_promotor: !form.es_promotor })}><span /></button>
      </div>
      <div className="sw">
        <span>Cuenta activa</span>
        <button type="button" aria-pressed={form.activo} aria-label="Cuenta activa"
          onClick={() => setForm({ ...form, activo: !form.activo })}><span /></button>
      </div>

      <label className="lb" style={{ display: 'block', fontSize: 11, fontWeight: 600,
        textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--tinta-2)',
        margin: '4px 0 6px' }}>
        Clientes que puede ver
      </label>
      <ul className="lista-chk">
        {clientes.map(c => (
          <li key={c.id}>
            <label>
              <input type="checkbox" checked={misClientes.includes(c.id)}
                onChange={e => setMisClientes(e.target.checked
                  ? [...misClientes, c.id]
                  : misClientes.filter(x => x !== c.id))} />
              {c.nombre}
            </label>
          </li>
        ))}
      </ul>
      {clientes.length === 0 && (
        <p className="nota-panel">Todavía no hay clientes registrados.</p>
      )}
    </>
  )

  return (
    <>
      <div className="tope">
        <div>
          <h2 className="disp">Usuarios</h2>
          <p>{cargando ? 'Cargando…' : `${usuarios.length} en la organización`}</p>
        </div>
        {editable && <button className="btn" onClick={abrirAlta}>Dar de alta</button>}
      </div>

      {aviso && <div className="aviso error" role="alert">{aviso}</div>}
      {ok && <div className="aviso ok" role="status">{ok}</div>}

      <div className="tabla">
        {cargando ? <p className="vacio">Cargando usuarios…</p> : (
          <table>
            <thead>
              <tr>
                <th>Nombre</th><th>Perfil</th><th>Región</th>
                <th>Clientes</th><th>Estado</th><th></th>
              </tr>
            </thead>
            <tbody>
              {usuarios.map(u => (
                <tr key={u.id}>
                  <td>
                    <b>{u.nombre}</b>
                    {u.es_admin_raiz && <span className="marca-raiz">Raíz</span>}
                    {u.es_promotor && (
                      <><br /><span style={{ color: 'var(--tinta-2)', fontSize: 11.5 }}>
                        Trabaja en campo</span></>
                    )}
                  </td>
                  <td>{u.perfil?.nombre ?? '—'}</td>
                  <td>{u.region?.nombre ?? 'Toda la organización'}</td>
                  <td>{nombresClientes(u.id)}</td>
                  <td>{u.activo
                    ? <span className="chip c-ok">ACTIVO</span>
                    : <span className="chip c-pen">INACTIVO</span>}</td>
                  <td style={{ textAlign: 'right' }}>
                    {editable && !u.es_admin_raiz && (
                      <button className="btn sec" style={{ minHeight: 38, fontSize: 14 }}
                        onClick={() => abrirEdicion(u)}>Editar</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p className="nota-panel" style={{ marginTop: 14 }}>
        El administrador raíz no se puede modificar ni desactivar desde la consola.
        Es lo que impide que un cliente con permisos amplios deje fuera a la agencia
        de su propia plataforma.
      </p>

      {/* ---------------- edicion ---------------- */}
      {editando && (
        <>
          <div className="velo" onClick={() => setEditando(null)} />
          <div className="panel" role="dialog" aria-modal="true" aria-label="Editar usuario">
            <h3>Editar usuario</h3>
            <form onSubmit={guardar} noValidate>
              {camposComunes}
              <div className="dos" style={{ marginTop: 6 }}>
                <button type="button" className="btn sec" onClick={() => setEditando(null)}>
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

      {/* ---------------- alta ---------------- */}
      {altaAbierta && (
        <>
          <div className="velo" onClick={() => setAltaAbierta(false)} />
          <div className="panel" role="dialog" aria-modal="true" aria-label="Dar de alta usuario">
            <h3>Dar de alta</h3>
            {pendientes.length === 0 ? (
              <>
                <p className="nota-panel">
                  No hay cuentas de acceso pendientes de perfil.
                </p>
                <p className="nota-panel">
                  Crear la cuenta de acceso se hace desde el panel de Supabase, en
                  Authentication → Users → Add user, marcando la confirmación
                  automática. En cuanto exista, aparecerá aquí para completar su
                  perfil, su región y los clientes que podrá ver.
                </p>
                <button type="button" className="btn sec bloque"
                  onClick={() => setAltaAbierta(false)}>Cerrar</button>
              </>
            ) : (
              <form onSubmit={darAlta} noValidate>
                <div className="campo">
                  <label htmlFor="u-cta">Cuenta de acceso</label>
                  <select id="u-cta" value={cuenta} onChange={e => setCuenta(e.target.value)}>
                    <option value="">Elige una cuenta</option>
                    {pendientes.map(p => (
                      <option key={p.id} value={p.id}>{p.correo}</option>
                    ))}
                  </select>
                </div>
                <p className="nota-panel">
                  Estas son las cuentas que ya existen en el sistema de acceso pero
                  todavía no tienen perfil en la plataforma.
                </p>
                {camposComunes}
                <div className="dos" style={{ marginTop: 6 }}>
                  <button type="button" className="btn sec" onClick={() => setAltaAbierta(false)}>
                    Cancelar
                  </button>
                  <button className="btn" disabled={guardando}>
                    {guardando ? 'Dando de alta…' : 'Dar de alta'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </>
      )}
    </>
  )
}
