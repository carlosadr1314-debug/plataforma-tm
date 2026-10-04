import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'

export default function Login() {
  const [correo, setCorreo] = useState('')
  const [clave, setClave] = useState('')
  const [error, setError] = useState('')
  const [enviando, setEnviando] = useState(false)

  async function entrar(e: FormEvent) {
    e.preventDefault()
    setError('')

    if (!correo.includes('@')) {
      setError('Escribe un correo completo, por ejemplo nombre@empresa.com')
      return
    }
    if (clave.length < 6) {
      setError('La contraseña debe tener al menos 6 caracteres')
      return
    }

    setEnviando(true)
    const { error } = await supabase.auth.signInWithPassword({
      email: correo.trim(), password: clave,
    })
    setEnviando(false)

    if (error) {
      setError(
        error.message.toLowerCase().includes('invalid')
          ? 'Correo o contraseña incorrectos. Revisa ambos e intenta de nuevo.'
          : 'No se pudo iniciar sesión. Revisa tu conexión e intenta de nuevo.'
      )
    }
  }

  return (
    <div className="login">
      <form className="caja" onSubmit={entrar} noValidate>
        <h1 className="disp">Plataforma TM</h1>
        <p className="sub">Consola de administración</p>

        {error && <div className="aviso error" role="alert">{error}</div>}

        <div className={'campo' + (error ? ' malo' : '')}>
          <label htmlFor="correo">Correo</label>
          <input id="correo" type="email" autoComplete="username"
            value={correo} onChange={e => setCorreo(e.target.value)} />
        </div>

        <div className={'campo' + (error ? ' malo' : '')}>
          <label htmlFor="clave">Contraseña</label>
          <input id="clave" type="password" autoComplete="current-password"
            value={clave} onChange={e => setClave(e.target.value)} />
        </div>

        <button className="btn bloque" disabled={enviando}>
          {enviando ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </div>
  )
}
