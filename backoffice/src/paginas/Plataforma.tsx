import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'

// =====================================================================
// Panel de plataforma
//
// Lo ve unicamente quien esta dado de alta en plataforma_admin, que a
// proposito no pertenece a ninguna empresa.
//
// Muestra cuantas empresas hay y de que tamano, pero NO deja asomarse
// a sus datos. Ver por dentro la operacion de un cliente no deberia
// ser algo que el sistema permita, ni siquiera a quien lo opera.
// =====================================================================

type Empresa = {
  empresa: string; codigo: string; alta: string
  administrador: string | null; correo: string | null
  usuarios: number; clientes: number; puntos_venta: number
}
type AdminPlat = { correo: string; nota: string | null; desde: string }

const vacio = { nombre: '', slug: '', correo: '', nombre_admin: '' }

// A donde debe regresar quien abra un enlace de contrasena: aqui
// mismo. En desarrollo es localhost, en produccion GitHub Pages, sin
// tener que tocar nada entre uno y otro.
const regresarA = () => window.location.origin + import.meta.env.BASE_URL


// De "Grupo Bimbo" sale "grupobimbo": minusculas, sin acentos, sin
// nada que no sea letra o numero. Es lo que exige la base.
const aCodigo = (s: string) =>
  s.toLowerCase()
   .normalize('NFD').replace(/[̀-ͯ]/g, '')
   .replace(/[^a-z0-9]/g, '')
   .slice(0, 30)

export default function Plataforma() {
  const [empresas, setEmpresas] = useState<Empresa[]>([])
  const [admins, setAdmins] = useState<AdminPlat[]>([])
  const [cargando, setCargando] = useState(true)

  const [abierto, setAbierto] = useState(false)
  const [form, setForm] = useState({ ...vacio })
  const [slugTocado, setSlugTocado] = useState(false)
  const [guardando, setGuardando] = useState(false)

  const [correoAdmin, setCorreoAdmin] = useState('')
  const [enlace, setEnlace] = useState<null | { correo: string; url: string; titulo: string }>(null)
  const [copiado, setCopiado] = useState(false)

  // El enlace deja que la persona elija su propia contrasena. Asi
  // nadie —ni tu— conoce la clave de un cliente.
  async function generarEnlace(correo: string, titulo: string) {
    setAviso(''); setOk('')
    const { data, error } = await supabase.functions.invoke('crear-cuenta', {
      body: { tipo: 'enlace_contrasena', correo, regresar_a: regresarA() },
    })
    if (error) {
      let detalle = ''
      try { detalle = (await (error as any).context?.json())?.error ?? '' } catch { /* nada */ }
      setAviso(detalle || 'No se pudo generar el enlace.')
      return
    }
    setCopiado(false)
    setEnlace({ correo, url: (data as any)?.enlace ?? '', titulo })
  }
  const [aviso, setAviso] = useState('')
  const [ok, setOk] = useState('')

  async function cargar() {
    const [e, a] = await Promise.all([
      supabase.rpc('resumen_empresas'),
      supabase.rpc('admins_plataforma'),
    ])
    setEmpresas((e.data as Empresa[]) ?? [])
    setAdmins((a.data as AdminPlat[]) ?? [])
    setCargando(false)
  }
  useEffect(() => { cargar() }, [])

  function abrirAlta() {
    setForm({ ...vacio }); setSlugTocado(false); setAviso(''); setOk('')
    setAbierto(true)
  }

  async function darAlta(e: FormEvent) {
    e.preventDefault()
    setAviso('')
    if (!form.correo.includes('@')) { setAviso('Escribe el correo de quien la va a administrar.'); return }
    if (!form.nombre.trim())     { setAviso('Escribe el nombre de la empresa.'); return }
    if (!form.nombre_admin.trim()){ setAviso('Escribe el nombre de la persona que la va a administrar.'); return }
    if (!/^[a-z0-9]{3,30}$/.test(form.slug)) {
      setAviso('El código de empresa debe tener de 3 a 30 caracteres, solo minúsculas y números.')
      return
    }

    const correo = form.correo.trim().toLowerCase()
    setGuardando(true)

    // Primero la cuenta de acceso, que exige la llave de servicio y
    // por eso pasa por la funcion de borde.
    const { data: hecho, error: errCuenta } = await supabase.functions.invoke('crear-cuenta', {
      body: { tipo: 'cuenta_empresa', correo, regresar_a: regresarA() },
    })
    if (errCuenta) {
      setGuardando(false)
      let detalle = ''
      try { detalle = (await (errCuenta as any).context?.json())?.error ?? '' } catch { /* nada */ }
      setAviso(detalle || 'No se pudo crear la cuenta de acceso. ' +
        'Si dice que la función no existe, falta desplegar crear-cuenta en Supabase.')
      return
    }

    // Y ya con la cuenta, la empresa.
    const { error } = await supabase.rpc('alta_empresa', {
      p_nombre: form.nombre.trim(),
      p_slug: form.slug,
      p_correo_admin: correo,
      p_nombre_admin: form.nombre_admin.trim(),
    })
    setGuardando(false)

    if (error) { setAviso(error.message); return }
    setAbierto(false)
    setEnlace({ correo, url: (hecho as any)?.enlace ?? '',
                titulo: `${form.nombre} quedó dada de alta` })
    cargar()
  }

  async function nombrarAdmin(e: FormEvent) {
    e.preventDefault()
    setAviso(''); setOk('')
    if (!correoAdmin.includes('@')) { setAviso('Escribe un correo completo.'); return }
    const { error } = await supabase.rpc('alta_admin_plataforma', {
      p_correo: correoAdmin.trim(), p_nota: null,
    })
    if (error) { setAviso(error.message); return }
    setOk(`${correoAdmin.trim()} ya es administrador de plataforma.`)
    setCorreoAdmin('')
    cargar()
  }

  return (
    <div className="plat">
      <div className="plat-barra">
        <div className="plat-marca">
          PLATAFORMA TM
          <em>Administración de empresas</em>
        </div>
        <button className="btn sec" onClick={() => supabase.auth.signOut()}>
          Cerrar sesión
        </button>
      </div>

      <div className="plat-cuerpo">
        <div className="tope">
          <div>
            <h2 className="disp">Empresas</h2>
            <p>{cargando ? 'Cargando…'
                : empresas.length === 0 ? 'Todavía no hay ninguna'
                : `${empresas.length} ${empresas.length === 1 ? 'empresa' : 'empresas'} en la plataforma`}</p>
          </div>
          <button className="btn" onClick={abrirAlta}>Dar de alta empresa</button>
        </div>

        {aviso && <div className="aviso error" role="alert">{aviso}</div>}
        {ok && <div className="aviso ok" role="status">{ok}</div>}

        <div className="tabla">
          <table>
            <thead>
              <tr>
                <th>Empresa</th><th>Código</th><th>Administrador</th><th>Alta</th>
                <th className="der">Usuarios</th>
                <th className="der">Clientes</th>
                <th className="der">PDV</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {empresas.map(e => (
                <tr key={e.codigo}>
                  <td><b>{e.empresa}</b></td>
                  <td><code className="plat-codigo">{e.codigo}</code></td>
                  <td>
                    {e.administrador ?? '—'}
                    {e.correo && <><br /><span className="plat-correo">{e.correo}</span></>}
                  </td>
                  <td className="num">{e.alta}</td>
                  <td className="num der">{e.usuarios}</td>
                  <td className="num der">{e.clientes}</td>
                  <td className="num der">{e.puntos_venta}</td>
                  <td className="der">
                    {e.correo && (
                      <button className="btn sec" style={{ minHeight: 34, fontSize: 12.5 }}
                              onClick={() => generarEnlace(e.correo as string,
                                `Enlace de contraseña para ${e.empresa}`)}>
                        Enlace de contraseña
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {!cargando && empresas.length === 0 && (
                <tr><td colSpan={8} className="sinnada">
                  Ninguna empresa dada de alta todavía.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>

        <p className="plat-nota">
          Aquí sólo se ve el tamaño de cada empresa, no su información.
          La operación de cada cliente queda fuera del alcance de esta
          cuenta a propósito.
        </p>

        <div className="tope" style={{ marginTop: 34 }}>
          <div>
            <h2 className="disp">Administradores de plataforma</h2>
            <p>Quienes pueden dar de alta empresas</p>
          </div>
        </div>

        <div className="tabla">
          <table>
            <thead><tr><th>Correo</th><th>Nota</th><th>Desde</th></tr></thead>
            <tbody>
              {admins.map(a => (
                <tr key={a.correo}>
                  <td>{a.correo}</td>
                  <td>{a.nota ?? '—'}</td>
                  <td className="num">{a.desde}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <form className="plat-sumar" onSubmit={nombrarAdmin}>
          <div className="campo" style={{ flex: 1, marginBottom: 0 }}>
            <label htmlFor="pa-correo">Agregar otro administrador de plataforma</label>
            <input id="pa-correo" type="email" value={correoAdmin}
                   placeholder="su correo, ya creado en Supabase"
                   onChange={ev => setCorreoAdmin(ev.target.value)} />
          </div>
          <button className="btn sec">Agregar</button>
        </form>
      </div>

      {enlace && (
        <>
          <div className="velo" onClick={() => setEnlace(null)} />
          <div className="panel" role="dialog" aria-modal="true" aria-label="Enlace de contraseña">
            <h3>{enlace.titulo}</h3>
            <p className="nota-panel">
              Pásale este enlace a <strong>{enlace.correo}</strong> por donde
              prefieras. Al abrirlo elige su contraseña; nadie más la conoce.
              Sirve una sola vez y vence; si se le pasa, genera otro desde la
              tabla.
            </p>
            <textarea className="enlace-caja" readOnly value={enlace.url}
                      onFocus={ev => ev.currentTarget.select()} rows={3} />
            <div className="dos" style={{ marginTop: 6 }}>
              <button type="button" className="btn sec"
                      onClick={() => { navigator.clipboard?.writeText(enlace.url); setCopiado(true) }}>
                {copiado ? 'Copiado' : 'Copiar enlace'}
              </button>
              <button type="button" className="btn" onClick={() => setEnlace(null)}>
                Listo
              </button>
            </div>
          </div>
        </>
      )}

      {/* ---------------- alta de empresa ---------------- */}
      {abierto && (
        <>
          <div className="velo" onClick={() => setAbierto(false)} />
          <div className="panel" role="dialog" aria-modal="true" aria-label="Dar de alta empresa">
            <h3>Dar de alta empresa</h3>

            <form onSubmit={darAlta}>
              {aviso && <div className="aviso error" role="alert">{aviso}</div>}

              <div className="campo">
                <label htmlFor="e-nombre">Nombre de la empresa</label>
                <input id="e-nombre" value={form.nombre}
                       onChange={ev => {
                         const nombre = ev.target.value
                         setForm(f => ({ ...f, nombre,
                           slug: slugTocado ? f.slug : aCodigo(nombre) }))
                       }} />
              </div>

              <div className="campo">
                <label htmlFor="e-slug">Código de empresa</label>
                <input id="e-slug" value={form.slug}
                       onChange={ev => { setSlugTocado(true)
                                         setForm({ ...form, slug: aCodigo(ev.target.value) }) }} />
                <small className="plat-ayuda">
                  Es lo que sus promotores teclean una sola vez al instalar la
                  aplicación. Minúsculas y números, sin espacios.
                </small>
              </div>

              <div className="campo">
                <label htmlFor="e-admin">Quién la va a administrar</label>
                <input id="e-admin" value={form.nombre_admin}
                       placeholder="nombre de la persona"
                       onChange={ev => setForm({ ...form, nombre_admin: ev.target.value })} />
              </div>

              <div className="campo">
                <label htmlFor="e-correo">Su correo</label>
                <input id="e-correo" type="email" value={form.correo}
                       onChange={ev => setForm({ ...form, correo: ev.target.value })} />
              </div>

              <p className="nota-panel">
                Se crea la empresa con sus cuatro perfiles de permisos
                —Administrador, Supervisor, Cliente y Promotor— y un solo
                usuario: esta persona, como administrador raíz. De ahí en
                adelante ella da de alta a su propio equipo.
              </p>
              <p className="nota-panel">
                No se le pone contraseña. Al terminar te doy un enlace para
                que ella elija la suya: así ni tú la conoces.
              </p>

              <div className="dos" style={{ marginTop: 6 }}>
                <button type="button" className="btn sec" onClick={() => setAbierto(false)}>
                  Cancelar
                </button>
                <button className="btn" disabled={guardando}>
                  {guardando ? 'Dando de alta…' : 'Dar de alta'}
                </button>
              </div>
            </form>
          </div>
        </>
      )}
    </div>
  )
}
