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

function Rutas() {
  const { sesion, cargando } = useSesion()
  if (cargando) {
    return <div className="login"><p style={{ color: 'var(--tinta-2)' }}>Cargando…</p></div>
  }
  if (!sesion) return <Login />
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
