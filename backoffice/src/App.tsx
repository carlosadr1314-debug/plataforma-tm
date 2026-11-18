import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { ProveedorSesion, useSesion } from './lib/sesion'
import Layout from './componentes/Layout'
import Login from './paginas/Login'
import Panel from './paginas/Panel'
import Pdvs from './paginas/Pdvs'
import Catalogo from './paginas/Catalogo'
import Formularios from './paginas/Formularios'
import FormularioEditor from './paginas/FormularioEditor'
import Itinerarios from './paginas/Itinerarios'
import Usuarios from './paginas/Usuarios'
import Visitas from './paginas/Visitas'
import Mapa from './paginas/Mapa'
import Plataforma from './paginas/Plataforma'
import { SinPerfil, SoloApp } from './paginas/Bloqueado'
import NuevaContrasena from './paginas/NuevaContrasena'

function Rutas() {
  const { sesion, perfil, esSuperadmin, recuperando, cargando } = useSesion()

  if (cargando) {
    return <div className="login"><p style={{ color: 'var(--tinta-2)' }}>Cargando…</p></div>
  }
  if (!sesion) return <Login />

  // Antes que nada: si llego por un enlace de contrasena, lo unico
  // que puede hacer es elegirla.
  if (recuperando) return <NuevaContrasena />

  // El administrador de plataforma no pertenece a ninguna empresa:
  // no tiene fila en usuario y por eso no tiene perfil.
  if (!perfil && esSuperadmin) return <Plataforma />

  // Cuenta creada pero sin asignar a una empresa todavia.
  if (!perfil) return <SinPerfil />

  // El promotor trabaja en la aplicacion. Esto es claridad, no
  // seguridad: lo que de verdad lo limita son las politicas de la
  // base, que no le permiten nada fuera de su ruta.
  if (!perfil.puede_portal) return <SoloApp />

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Panel />} />
        <Route path="visitas" element={<Visitas />} />
        <Route path="pdvs" element={<Pdvs />} />
        <Route path="catalogo" element={<Catalogo />} />
        <Route path="formularios" element={<Formularios />} />
        <Route path="formularios/:id" element={<FormularioEditor />} />
        <Route path="itinerarios" element={<Itinerarios />} />
        <Route path="usuarios" element={<Usuarios />} />
        <Route path="visitas/seguimiento" element={<Mapa />} />
      </Route>
    </Routes>
  )
}

export default function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <ProveedorSesion><Rutas /></ProveedorSesion>
    </BrowserRouter>
  )
}
