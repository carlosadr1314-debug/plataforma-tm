import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'

export type Perfil = {
  nombre: string
  perfil: string
  permisos: string[]
  organizacion: string
  puede_portal: boolean
  es_admin_raiz: boolean
}

type Ctx = {
  sesion: Session | null
  perfil: Perfil | null
  esSuperadmin: boolean
  recuperando: boolean
  cargando: boolean
}

const SesionCtx = createContext<Ctx>({
  sesion: null, perfil: null, esSuperadmin: false, recuperando: false, cargando: true,
})

export function ProveedorSesion({ children }: { children: ReactNode }) {
  const [sesion, setSesion] = useState<Session | null>(null)
  const [perfil, setPerfil] = useState<Perfil | null>(null)
  const [esSuperadmin, setEsSuperadmin] = useState(false)
  const [recuperando, setRecuperando] = useState(false)
  const [cargando, setCargando] = useState(true)
  // Hasta que Supabase conteste si hay sesion guardada, no se decide
  // nada: sin esto se alcanza a ver la pantalla de acceso antes de
  // saber que la persona ya estaba dentro.
  const [listo, setListo] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSesion(data.session)
      setListo(true)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((evento, s) => {
      // Llego desde un enlace de contrasena: hay sesion, pero lo
      // unico que toca es elegir la clave.
      if (evento === 'PASSWORD_RECOVERY') setRecuperando(true)
      setSesion(s)
      setListo(true)
      if (!s) { setPerfil(null); setEsSuperadmin(false); setRecuperando(false) }
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  // Se busca la ficha por identificador de persona, no por el objeto
  // de sesion: ese cambia solo cada vez que se renueva el token, y
  // volveria a consultar sin necesidad.
  const uid = sesion?.user?.id ?? null

  useEffect(() => {
    if (!listo) return
    if (!uid) { setPerfil(null); setEsSuperadmin(false); setCargando(false); return }
    let vivo = true
    // Mientras no se sepa que perfil tiene, se espera. Si no, al
    // entrar se alcanza a ver "cuenta sin perfil" un instante: la
    // sesion ya existe pero la ficha todavia no ha llegado.
    setCargando(true)
    ;(async () => {
      const { data } = await supabase
        .from('usuario')
        .select('nombre, es_admin_raiz, perfil:perfil_id(nombre, permisos, puede_portal), organizacion:organizacion_id(nombre)')
        .eq('id', uid)
        .maybeSingle()
      if (!vivo) return

      if (data) {
        const p: any = data
        setPerfil({
          nombre: p.nombre,
          perfil: p.perfil?.nombre ?? '',
          permisos: p.perfil?.permisos ?? [],
          organizacion: p.organizacion?.nombre ?? '',
          puede_portal: p.perfil?.puede_portal ?? true,
          es_admin_raiz: p.es_admin_raiz === true,
        })
      } else {
        // Sin fila en usuario: o es administrador de plataforma, que
        // a proposito no pertenece a ninguna empresa, o es una cuenta
        // a la que todavia no le asignan perfil.
        const { data: sa } = await supabase.rpc('es_superadmin')
        if (vivo) setEsSuperadmin(sa === true)
      }
      if (vivo) setCargando(false)
    })()
    return () => { vivo = false }
  }, [uid, listo])

  return (
    <SesionCtx.Provider value={{ sesion, perfil, esSuperadmin, recuperando, cargando }}>
      {children}
    </SesionCtx.Provider>
  )
}

export const useSesion = () => useContext(SesionCtx)

// Los permisos se leen tal cual, sin llave maestra. Desde la
// migracion 007 la base tampoco trata 'admin' como comodin: si aqui
// se dejara, la pantalla ofreceria botones que la base rechaza.
export const puede = (p: Perfil | null, clave: string) =>
  !!p && p.permisos.includes(clave)

// Dar de alta usuarios no lo concede 'admin'. Lo puede el
// administrador raiz de la empresa, o quien tenga el permiso
// delegado explicitamente.
export const puedeGestionarUsuarios = (p: Perfil | null) =>
  !!p && (p.es_admin_raiz || p.permisos.includes('gestionar_usuarios'))
