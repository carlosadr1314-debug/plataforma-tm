import { useEffect, useState, useCallback, type FormEvent } from 'react'
import HorarioSemanal, { SEMANA_VACIA, minutosEntre, type Dia }
  from '../componentes/HorarioSemanal'
import { supabase } from '../lib/supabase'
import { useSesion, puedeGestionarUsuarios } from '../lib/sesion'

type Fila = { id: string; nombre: string }
type PerfilFila = Fila & { puede_portal: boolean }
type Usuario = {
  id: string; nombre: string; telefono: string | null
  es_promotor: boolean; es_admin_raiz: boolean; activo: boolean; codigo: string | null
  perfil: Fila | null
  region: Fila | null
}
type Pendiente = { id: string; correo: string; creado: string }

const vacio = {
  nombre: '', telefono: '', perfil_id: '', region_id: '',
  es_promotor: false, activo: true,
}

// A donde debe regresar quien abra un enlace de contrasena: aqui
// mismo. En desarrollo es localhost, en produccion GitHub Pages, sin
// tener que tocar nada entre uno y otro.
const regresarA = () => window.location.origin + import.meta.env.BASE_URL


export default function Usuarios() {
  const { perfil: yo } = useSesion()
  // Dar de alta y editar a otros ya no lo concede 'admin': lo puede el
  // administrador raiz, o quien tenga el permiso delegado.
  const editable = puedeGestionarUsuarios(yo)

  const [usuarios, setUsuarios] = useState<Usuario[]>([])
  const [perfiles, setPerfiles] = useState<PerfilFila[]>([])
  const [regiones, setRegiones] = useState<Fila[]>([])
  const [clientes, setClientes] = useState<Fila[]>([])
  const [asignados, setAsignados] = useState<Record<string, string[]>>({})
  const [cargando, setCargando] = useState(true)

  const [aviso, setAviso] = useState('')
  const [ok, setOk] = useState('')

  const [editando, setEditando] = useState<Usuario | null>(null)
  const [form, setForm] = useState({ ...vacio })
  const [misClientes, setMisClientes] = useState<string[]>([])
  const [horarios, setHorarios] = useState<Record<string, any[]>>({})
  const [semana, setSemana] = useState<Dia[]>(SEMANA_VACIA())
  const [comida, setComida] = useState(60)
  const [orgId, setOrgId] = useState('')
  const [guardando, setGuardando] = useState(false)

  const [altaAbierta, setAltaAbierta] = useState(false)
  const [pendientes, setPendientes] = useState<Pendiente[]>([])
  const [cuenta, setCuenta] = useState('')
  const [modo, setModo] = useState<'promotor' | 'persona' | 'pendiente'>('promotor')
  const [acceso, setAcceso] = useState({ codigo: '', nip: '', correo: '', contrasena: '' })
  // Lo que se le entrega al administrador una sola vez, al dar de alta.
  const [entregar, setEntregar] = useState<null | { titulo: string; lineas: [string, string][] }>(null)
  const [slug, setSlug] = useState('')

  const nipAlAzar = () =>
    setAcceso(a => ({ ...a, nip: String(Math.floor(10000000 + Math.random() * 90000000)) }))

  function flash(m: string) { setOk(m); setTimeout(() => setOk(''), 2600) }

  const [enlace, setEnlace] = useState<null | { titulo: string; url: string; para: string }>(null)
  const [copiado, setCopiado] = useState(false)
  const [nipNuevo, setNipNuevo] = useState('')

  async function llamar(body: Record<string, unknown>) {
    const { data, error } = await supabase.functions.invoke('crear-cuenta', { body })
    if (error) {
      let detalle = ''
      try { detalle = (await (error as any).context?.json())?.error ?? '' } catch { /* nada */ }
      setAviso(detalle || 'No se pudo completar. ' +
        'Si dice que la función no existe, falta desplegar crear-cuenta en Supabase.')
      return null
    }
    return data as any
  }

  // Para quien tiene correo: un enlace de un solo uso con el que
  // elige su propia contrasena. Nadie mas la conoce.
  async function enlaceContrasena(u: Usuario) {
    setAviso('')
    const d = await llamar({ tipo: 'enlace_contrasena', usuario_id: u.id,
                             regresar_a: regresarA() })
    if (!d) return
    setCopiado(false)
    setEnlace({ titulo: 'Enlace de contraseña', url: d.enlace ?? '', para: d.correo ?? u.nombre })
  }

  // El promotor no tiene correo de verdad, asi que no hay enlace que
  // mandarle: su NIP se repone aqui y se le dice de viva voz.
  async function cambiarNip(u: Usuario) {
    setAviso('')
    if (!/^[0-9]{8}$/.test(nipNuevo)) { setAviso('El NIP debe tener exactamente 8 dígitos.'); return }
    const d = await llamar({ tipo: 'cambiar_nip', usuario_id: u.id, nip: nipNuevo })
    if (!d) return
    flash(`NIP de ${u.nombre} actualizado`)
    setNipNuevo('')
  }

  const cargar = useCallback(async () => {
    setCargando(true)
    const { data: us } = await supabase.from('usuario')
      .select('id,nombre,telefono,es_promotor,es_admin_raiz,activo,codigo,perfil:perfil_id(id,nombre),region:region_id(id,nombre)')
      .order('nombre')
    setUsuarios((us as any) ?? [])

    const { data: uc } = await supabase.from('usuario_cliente').select('usuario_id,cliente_id')
    const mapa: Record<string, string[]> = {}
    ;(uc ?? []).forEach(r => {
      (mapa[r.usuario_id] ??= []).push(r.cliente_id)
    })
    setAsignados(mapa)

    const { data: s } = await supabase.auth.getSession()
    if (s.session?.user?.id) {
      const { data: mio } = await supabase.from('usuario')
        .select('organizacion_id').eq('id', s.session.user.id).maybeSingle()
      if (mio?.organizacion_id) setOrgId(mio.organizacion_id)
    }

    const { data: hs } = await supabase.from('horario_promotor')
      .select('usuario_id,dia_semana,entrada,salida,minutos_comida')
    const porUsuario: Record<string, any[]> = {}
    ;(hs ?? []).forEach(h => { (porUsuario[h.usuario_id] ??= []).push(h) })
    setHorarios(porUsuario)

    setCargando(false)
  }, [])

  useEffect(() => {
    cargar()
    supabase.from('perfil').select('id,nombre,puede_portal').order('nombre')
      .then(({ data }) => setPerfiles(data ?? []))
    supabase.from('region').select('id,nombre').order('nombre')
      .then(({ data }) => setRegiones(data ?? []))
    supabase.from('cliente').select('id,nombre').order('nombre')
      .then(({ data }) => setClientes(data ?? []))
    supabase.from('organizacion').select('slug').maybeSingle()
      .then(({ data }) => setSlug(data?.slug ?? ''))
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

    // El horario vive aparte del usuario; se arma la semana completa
    // y se encienden los dias que tengan renglon.
    const suyo = horarios[u.id] ?? []
    const sem = SEMANA_VACIA()
    suyo.forEach(h => {
      const i = Number(h.dia_semana)
      if (i >= 0 && i <= 6) {
        sem[i] = { trabaja: true,
                   entrada: String(h.entrada).slice(0, 5),
                   salida: String(h.salida).slice(0, 5) }
      }
    })
    setSemana(sem)
    setComida(suyo.length ? Number(suyo[0].minutos_comida) : 60)

    setNipNuevo(''); setEnlace(null)
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

  /**
   * Deja el horario del promotor igual a lo que muestra la pantalla.
   * Se borra y se vuelve a poner en lugar de ir renglon por renglon:
   * son siete filas como mucho, y asi no quedan dias zombis de una
   * configuracion anterior.
   */
  async function guardarHorario(usuarioId: string, esPromotor: boolean) {
    const { error: errBorrar } = await supabase.from('horario_promotor')
      .delete().eq('usuario_id', usuarioId)
    if (errBorrar) return errBorrar.message

    // A quien deja de ser promotor se le quita el horario y ya.
    if (!esPromotor) return null

    const filas = semana.flatMap((d, i) => d.trabaja ? [{
      organizacion_id: orgId,
      usuario_id: usuarioId,
      dia_semana: i,
      entrada: d.entrada,
      salida: d.salida,
      minutos_comida: comida,
    }] : [])
    if (filas.length === 0) return null

    const { error } = await supabase.from('horario_promotor').insert(filas)
    return error ? error.message : null
  }

  async function guardar(e: FormEvent) {
    e.preventDefault()
    setAviso('')
    if (!editando) return
    if (!form.nombre.trim()) { setAviso('Escribe el nombre de la persona.'); return }
    if (!form.perfil_id) { setAviso('Elige un perfil.'); return }

    // Un horario con la salida antes de la entrada lo rechaza la base
    // igual, pero con un mensaje que no se entiende.
    const malos = semana.filter(d => d.trabaja && minutosEntre(d.entrada, d.salida) <= 0)
    if (form.es_promotor && malos.length) {
      setAviso('Hay días con la salida antes de la entrada. Corrígelos antes de guardar.')
      return
    }

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
    const errHorario = await guardarHorario(editando.id, form.es_promotor)
    setGuardando(false)
    if (errHorario) { setAviso('Se guardó la persona, pero el horario no: ' + errHorario); return }
    setEditando(null)
    cargar()
    flash('Usuario actualizado')
  }

  async function abrirAlta() {
    setAviso(''); setCuenta(''); setEntregar(null)
    setForm({ ...vacio })
    setAcceso({ codigo: '', nip: '', correo: '', contrasena: '' })
    setMisClientes([]); setModo('promotor')
    const { data } = await supabase.rpc('usuarios_sin_perfil')
    setPendientes((data as any) ?? [])
    setAltaAbierta(true)
  }

  // El alta de una cuenta nueva pasa por la funcion de borde: crear
  // una cuenta de acceso exige la llave de servicio, que no puede
  // estar en el navegador.
  async function darAltaNueva(e: FormEvent) {
    e.preventDefault()
    setAviso('')
    if (!form.nombre.trim()) { setAviso('Escribe el nombre de la persona.'); return }
    if (!form.perfil_id) { setAviso('Elige un perfil.'); return }
    if (modo === 'promotor') {
      if (!/^[0-9]{4,10}$/.test(acceso.codigo))
        { setAviso('El código de empleado debe tener entre 4 y 10 dígitos.'); return }
      if (!/^[0-9]{8}$/.test(acceso.nip))
        { setAviso('El NIP debe tener exactamente 8 dígitos.'); return }
    } else if (!acceso.correo.includes('@')) {
      setAviso('Escribe un correo completo.'); return
    }

    setGuardando(true)
    const { data, error } = await supabase.functions.invoke('crear-cuenta', {
      body: {
        tipo: modo,
        nombre: form.nombre.trim(),
        telefono: form.telefono.trim() || null,
        perfil_id: form.perfil_id,
        region_id: form.region_id || null,
        clientes: misClientes,
        codigo: acceso.codigo.trim(),
        nip: acceso.nip.trim(),
        correo: acceso.correo.trim(),
        regresar_a: regresarA(),
      },
    })
    setGuardando(false)

    if (error) {
      // La funcion devuelve el motivo en el cuerpo, no en el mensaje.
      let detalle = ''
      try { detalle = (await (error as any).context?.json())?.error ?? '' } catch { /* nada */ }
      setAviso(detalle || 'No se pudo dar de alta. ' +
        'Si dice que la función no existe, falta desplegarla en Supabase.')
      return
    }
    if ((data as any)?.error) { setAviso((data as any).error); return }

    cargar()
    if (modo === 'promotor') {
      setEntregar({ titulo: 'Datos de acceso del promotor', lineas: [
        ['Código de empresa', slug],
        ['Código de empleado', acceso.codigo.trim()],
        ['NIP', acceso.nip.trim()],
      ] })
    } else {
      setAltaAbierta(false)
      setCopiado(false)
      setEnlace({ titulo: 'Dado de alta', url: (data as any)?.enlace ?? '',
                  para: acceso.correo.trim() })
    }
  }

  async function darAlta(e: FormEvent) {
    e.preventDefault()
    setAviso('')
    if (!cuenta) { setAviso('Elige la cuenta a la que vas a dar perfil.'); return }
    if (!form.nombre.trim()) { setAviso('Escribe el nombre de la persona.'); return }
    if (!form.perfil_id) { setAviso('Elige un perfil.'); return }

    // Un horario con la salida antes de la entrada lo rechaza la base
    // igual, pero con un mensaje que no se entiende.
    const malos = semana.filter(d => d.trabaja && minutosEntre(d.entrada, d.salida) <= 0)
    if (form.es_promotor && malos.length) {
      setAviso('Hay días con la salida antes de la entrada. Corrígelos antes de guardar.')
      return
    }

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

  // Un promotor necesita un perfil que NO entre al portal, y alguien
  // de oficina uno que SI. Ofrecer los dos deja crear gente que no
  // puede entrar a ningun lado.
  //
  // Al editar vale lo mismo, y con mas razon: quien entro como
  // promotor tiene un codigo de empleado y un correo interno; pasarlo
  // a Administrador con un desplegable lo dejaria con un perfil de
  // oficina y sin forma de entrar al portal. Cambiar de tipo no es
  // cambiar un campo, es rehacer la cuenta.
  const perfilesDelModo = editando
    ? perfiles.filter(p => p.puede_portal === !editando.codigo)
    : (!altaAbierta || modo === 'pendiente')
      ? perfiles
      : perfiles.filter(p => p.puede_portal === (modo === 'persona'))

  const nombresClientes = (id: string) => {
    const lista = (asignados[id] ?? [])
      .map(c => clientes.find(x => x.id === c)?.nombre)
      .filter(Boolean)
    return lista.length ? lista.join(', ') : '—'
  }

  const campos = (conInterruptores: boolean) => (
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
          {perfilesDelModo.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
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

      {conInterruptores && (
        <>
          {!editando?.codigo && (
            <div className="sw">
              <span>Trabaja en campo</span>
              <button type="button" aria-pressed={form.es_promotor} aria-label="Trabaja en campo"
                onClick={() => setForm({ ...form, es_promotor: !form.es_promotor })}><span /></button>
            </div>
          )}
          <div className="sw">
            <span>Cuenta activa</span>
            <button type="button" aria-pressed={form.activo} aria-label="Cuenta activa"
              onClick={() => setForm({ ...form, activo: !form.activo })}><span /></button>
          </div>
        </>
      )}

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

      {enlace && (
        <>
          <div className="velo" onClick={() => setEnlace(null)} />
          <div className="panel" role="dialog" aria-modal="true" aria-label="Enlace de contraseña">
            <h3>{enlace.titulo}</h3>
            <p className="nota-panel">
              Pásale este enlace a <strong>{enlace.para}</strong> por donde
              prefieras. Al abrirlo elige su contraseña; ni tú la conoces.
              Sirve una sola vez y vence; si se le pasa, genera otro desde
              su ficha.
            </p>
            <textarea className="enlace-caja" readOnly value={enlace.url} rows={3}
                      onFocus={ev => ev.currentTarget.select()} />
            <div className="dos" style={{ marginTop: 6 }}>
              <button type="button" className="btn sec"
                      onClick={() => { navigator.clipboard?.writeText(enlace.url); setCopiado(true) }}>
                {copiado ? 'Copiado' : 'Copiar enlace'}
              </button>
              <button type="button" className="btn" onClick={() => setEnlace(null)}>Listo</button>
            </div>
          </div>
        </>
      )}

      {/* ---------------- edicion ---------------- */}
      {editando && (
        <>
          <div className="velo" onClick={() => setEditando(null)} />
          <div className="panel" role="dialog" aria-modal="true" aria-label="Editar usuario">
            <h3>Editar usuario</h3>
            {editando.codigo ? (
              <div className="acceso-bloque">
                <p className="nota-panel" style={{ marginTop: 0 }}>
                  Entra a la aplicación con el código <code>{editando.codigo}</code>.
                  Si olvidó su NIP, ponle uno nuevo y díselo.
                </p>
                <div className="con-boton">
                  <input inputMode="numeric" value={nipNuevo} placeholder="NIP nuevo, 8 dígitos"
                         aria-label="NIP nuevo"
                         onChange={e => setNipNuevo(e.target.value.replace(/\D/g, '').slice(0, 8))} />
                  <button type="button" className="btn sec"
                          onClick={() => setNipNuevo(String(Math.floor(10000000 + Math.random() * 90000000)))}>
                    Generar
                  </button>
                  <button type="button" className="btn"
                          onClick={() => cambiarNip(editando)}>Cambiar</button>
                </div>
              </div>
            ) : (
              <div className="acceso-bloque">
                <p className="nota-panel" style={{ marginTop: 0 }}>
                  Si olvidó su contraseña, genera un enlace para que ponga una
                  nueva. Tú no la ves.
                </p>
                <button type="button" className="btn sec bloque"
                        onClick={() => enlaceContrasena(editando)}>
                  Generar enlace de contraseña
                </button>
              </div>
            )}

            <form onSubmit={guardar} noValidate>
              {campos(true)}

              {form.es_promotor && (
                <div className="bloque-horario">
                  <h4>Horario que le toca cumplir</h4>
                  <p className="nota-panel" style={{ marginTop: 0 }}>
                    Lo ve en su teléfono al hacer el check-in de seguridad, y es
                    contra esto que se mide su cumplimiento.
                  </p>
                  <HorarioSemanal dias={semana} comida={comida}
                                  onDias={setSemana} onComida={setComida} />
                </div>
              )}

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

            {entregar ? (
              <>
                <div className="aviso ok" role="status">
                  Listo. Ya puede entrar.
                </div>
                <p className="nota-panel">
                  <strong>{entregar.titulo}.</strong> Anótalos o pásaselos ahora:
                  por seguridad no se vuelven a mostrar.
                </p>
                <ul className="credenciales">
                  {entregar.lineas.map(([k, v]) => (
                    <li key={k}><span>{k}</span><code>{v}</code></li>
                  ))}
                </ul>
                <div className="dos" style={{ marginTop: 6 }}>
                  <button type="button" className="btn sec" onClick={abrirAlta}>
                    Dar de alta a otro
                  </button>
                  <button type="button" className="btn" onClick={() => setAltaAbierta(false)}>
                    Terminar
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="opciones" role="group" aria-label="Tipo de alta">
                  <button type="button" className={modo === 'promotor' ? 'on' : ''}
                          onClick={() => { setModo('promotor'); setAviso('')
                                           setForm(f => ({ ...f, perfil_id: '' })) }}>
                    Promotor
                  </button>
                  <button type="button" className={modo === 'persona' ? 'on' : ''}
                          onClick={() => { setModo('persona'); setAviso('')
                                           setForm(f => ({ ...f, perfil_id: '' })) }}>
                    Persona de oficina
                  </button>
                  {pendientes.length > 0 && (
                    <button type="button" className={modo === 'pendiente' ? 'on' : ''}
                            onClick={() => { setModo('pendiente'); setAviso('')
                                             setForm(f => ({ ...f, perfil_id: '' })) }}>
                      Cuenta pendiente ({pendientes.length})
                    </button>
                  )}
                </div>

                {aviso && <div className="aviso error" role="alert">{aviso}</div>}

                <form onSubmit={modo === 'pendiente' ? darAlta : darAltaNueva} noValidate>
                  {modo === 'promotor' && (
                    <>
                      <div className="campo">
                        <label htmlFor="u-cod">Código de empleado</label>
                        <input id="u-cod" inputMode="numeric" value={acceso.codigo}
                               placeholder="por ejemplo 1042"
                               onChange={e => setAcceso({ ...acceso,
                                 codigo: e.target.value.replace(/\D/g, '').slice(0, 10) })} />
                      </div>
                      <div className="campo">
                        <label htmlFor="u-nip">NIP de 8 dígitos</label>
                        <div className="con-boton">
                          <input id="u-nip" inputMode="numeric" value={acceso.nip}
                                 onChange={e => setAcceso({ ...acceso,
                                   nip: e.target.value.replace(/\D/g, '').slice(0, 8) })} />
                          <button type="button" className="btn sec" onClick={nipAlAzar}>
                            Generar
                          </button>
                        </div>
                      </div>
                      <p className="nota-panel">
                        El promotor entra en la aplicación con el código de empresa
                        <strong> {slug || '(sin asignar)'}</strong>, su código de empleado
                        y este NIP. Nunca escribe un correo.
                      </p>
                    </>
                  )}

                  {modo === 'persona' && (
                    <>
                      <div className="campo">
                        <label htmlFor="u-mail">Correo</label>
                        <input id="u-mail" type="email" value={acceso.correo}
                               onChange={e => setAcceso({ ...acceso, correo: e.target.value })} />
                      </div>
                      <p className="nota-panel">
                        No le pones contraseña. Al guardar te doy un enlace para
                        que ella elija la suya; así nadie más la conoce.
                      </p>
                    </>
                  )}

                  {modo === 'pendiente' && (
                    <>
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
                        Cuentas que ya existen en el sistema de acceso pero todavía
                        no tienen perfil en la plataforma.
                      </p>
                    </>
                  )}

                  {campos(false)}

                  <div className="dos" style={{ marginTop: 6 }}>
                    <button type="button" className="btn sec" onClick={() => setAltaAbierta(false)}>
                      Cancelar
                    </button>
                    <button className="btn" disabled={guardando}>
                      {guardando ? 'Dando de alta…' : 'Dar de alta'}
                    </button>
                  </div>
                </form>
              </>
            )}
          </div>
        </>
      )}

    </>
  )
}
