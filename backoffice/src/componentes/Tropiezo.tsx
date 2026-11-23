import { Component, type ReactNode } from 'react'

// =====================================================================
// Red de seguridad
//
// Un error en cualquier pantalla tiraba el arbol entero de React y
// dejaba la pagina en blanco: sin menu, sin aviso, y con lo que se
// estuviera capturando perdido. Esto lo detiene y muestra algo que se
// pueda leer y de donde se pueda salir.
//
// No arregla el error —para eso esta la consola del navegador, y el
// mensaje se muestra tal cual para poder reportarlo— pero evita que un
// detalle de una pantalla se lleve toda la aplicacion.
// =====================================================================

type Props = { children: ReactNode }
type Estado = { error: Error | null }

export default class Tropiezo extends Component<Props, Estado> {
  state: Estado = { error: null }

  static getDerivedStateFromError(error: Error): Estado {
    return { error }
  }

  componentDidCatch(error: Error, info: unknown) {
    console.error('Se cayo una pantalla:', error, info)
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <div className="tropiezo">
        <h2>Algo falló en esta pantalla</h2>
        <p>
          No se perdió nada de lo que ya estaba guardado, pero lo que estabas
          capturando en este momento sí. Recarga para seguir trabajando.
        </p>
        <p className="tropiezo-detalle">{this.state.error.message}</p>
        <button className="btn" onClick={() => location.reload()}>
          Recargar
        </button>
      </div>
    )
  }
}
