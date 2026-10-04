import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'

export type Perfil = {
  nombre: string
  perfil: string
  permisos: string[]
  organizacion: string
}

type Ctx = { sesion: Session | null; perfil: Perfil | null; cargando: boolean }
const SesionCtx = createContext<Ctx>({ sesion: null, perfil: null, cargando: true })

export function ProveedorSesion({ children }: { children: ReactNode }) {
  const [sesion, setSesion] = useState<Session | null>(null)
  const [perfil, setPerfil] = useState<Perfil | null>(null)
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSesion(data.session)
      if (!data.session) setCargando(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSesion(s)
      if (!s) { setPerfil(null); setCargando(false) }
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!sesion) return
    let vivo = true
    ;(async () => {
      const { data } = await supabase
        .from('usuario')
        .select('nombre, perfil:perfil_id(nombre, permisos), organizacion:organizacion_id(nombre)')
        .eq('id', sesion.user.id)
        .maybeSingle()
      if (!vivo) return
      if (data) {
        const p: any = data
        setPerfil({
          nombre: p.nombre,
          perfil: p.perfil?.nombre ?? '',
          permisos: p.perfil?.permisos ?? [],
          organizacion: p.organizacion?.nombre ?? '',
        })
      }
      setCargando(false)
    })()
    return () => { vivo = false }
  }, [sesion])

  return (
    <SesionCtx.Provider value={{ sesion, perfil, cargando }}>
      {children}
    </SesionCtx.Provider>
  )
}

export const useSesion = () => useContext(SesionCtx)
export const puede = (p: Perfil | null, clave: string) =>
  !!p && (p.permisos.includes('admin') || p.permisos.includes(clave))
