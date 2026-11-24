import { NavLink, Outlet } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useSesion } from '../lib/sesion'
import { IcoPanel, IcoTienda, IcoCaja, IcoGente, IcoForm, IcoRuta, IcoVisitas, IcoMarca, IcoReloj } from './Iconos'

export default function Layout() {
  const { perfil } = useSesion()
  const clase = ({ isActive }: { isActive: boolean }) => (isActive ? 'on' : '')
  const subclase = ({ isActive }: { isActive: boolean }) => 'sub' + (isActive ? ' on' : '')

  return (
    <div className="app">
      <aside className="side">
        <div className="marca">
          Plataforma TM
          <em>{perfil?.organizacion ?? ''}</em>
        </div>
        <nav aria-label="Navegación principal">
          <NavLink to="/" end className={clase}><IcoPanel /> Panel</NavLink>
          <NavLink to="/visitas" end className={clase}><IcoVisitas /> Visitas</NavLink>
          <NavLink to="/visitas/seguimiento" className={subclase}>Seguimiento en vivo</NavLink>
          <NavLink to="/clientes" className={clase}><IcoMarca /> Clientes</NavLink>
          <NavLink to="/pdvs" className={clase}><IcoTienda /> Puntos de venta</NavLink>
          <NavLink to="/catalogo" className={clase}><IcoCaja /> Catálogo</NavLink>
          <NavLink to="/formularios" className={clase}><IcoForm /> Formularios</NavLink>
          <NavLink to="/itinerarios" className={clase}><IcoRuta /> Itinerarios</NavLink>
          <NavLink to="/jornadas" className={clase}><IcoReloj /> Jornadas</NavLink>
          <NavLink to="/usuarios" className={clase}><IcoGente /> Usuarios</NavLink>
        </nav>
        <div className="pie">
          <b>{perfil?.nombre}</b>
          <span>{perfil?.perfil}</span>
          <button className="salir" onClick={() => supabase.auth.signOut()}>
            Cerrar sesión
          </button>
        </div>
      </aside>
      <main className="main"><Outlet /></main>
    </div>
  )
}
