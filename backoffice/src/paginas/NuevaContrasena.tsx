import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'

// Se muestra cuando alguien llega desde un enlace de contrasena.
// Es el unico momento en que la persona elige su clave, y nadie mas
// la ve: ni quien la dio de alta ni quien administra la plataforma.
export default function NuevaContrasena() {
  const [clave, setClave] = useState('')
  const [repite, setRepite] = useState('')
  const [aviso, setAviso] = useState('')
  const [listo, setListo] = useState(false)
  const [guardando, setGuardando] = useState(false)

  async function guardar(e: FormEvent) {
    e.preventDefault()
    setAviso('')
    if (clave.length < 8) { setAviso('La contraseña debe tener al menos 8 caracteres.'); return }
    if (clave !== repite) { setAviso('Las dos contraseñas no coinciden.'); return }

    setGuardando(true)
    const { error } = await supabase.auth.updateUser({ password: clave })
    setGuardando(false)
    if (error) {
      setAviso(error.message.toLowerCase().includes('expired')
        ? 'El enlace ya venció. Pide uno nuevo a quien administra el sistema.'
        : 'No se pudo guardar. ' + error.message)
      return
    }
    setListo(true)
  }

  return (
    <div className="login">
      <div className="caja">
        <h1 className="disp">{listo ? 'Contraseña guardada' : 'Elige tu contraseña'}</h1>

        {listo ? (
          <>
            <p className="sub">
              Ya puedes entrar con tu correo y esta contraseña.
            </p>
            <button className="btn bloque" onClick={() => location.reload()}>
              Entrar
            </button>
          </>
        ) : (
          <form onSubmit={guardar} noValidate>
            <p className="sub">
              Es la única vez que se te pide. Nadie más la conoce, ni quien
              administra el sistema.
            </p>
            {aviso && <div className="aviso error" role="alert">{aviso}</div>}
            <div className="campo">
              <label htmlFor="c1">Contraseña nueva</label>
              <input id="c1" type="password" value={clave} autoFocus
                     onChange={e => setClave(e.target.value)} />
            </div>
            <div className="campo">
              <label htmlFor="c2">Escríbela otra vez</label>
              <input id="c2" type="password" value={repite}
                     onChange={e => setRepite(e.target.value)} />
            </div>
            <button className="btn bloque" disabled={guardando}>
              {guardando ? 'Guardando…' : 'Guardar contraseña'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
