import { supabase } from '../lib/supabase'

function Caja({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="login">
      <div className="caja">
        <h1 className="disp">{titulo}</h1>
        {children}
        <button className="btn bloque" style={{ marginTop: 18 }}
                onClick={() => supabase.auth.signOut()}>
          Cerrar sesión
        </button>
      </div>
    </div>
  )
}

export function SinPerfil() {
  return (
    <Caja titulo="Cuenta sin perfil">
      <p className="sub">
        Tu cuenta existe pero todavía no está asignada a ninguna empresa.
        Pídele a quien administra el sistema que te dé de alta.
      </p>
    </Caja>
  )
}

export function SoloApp() {
  return (
    <Caja titulo="Esto es para la aplicación">
      <p className="sub">
        Tu cuenta es de promotor y se usa desde la aplicación del teléfono,
        no desde esta página. Ahí vas a encontrar tu ruta del día.
      </p>
    </Caja>
  )
}
