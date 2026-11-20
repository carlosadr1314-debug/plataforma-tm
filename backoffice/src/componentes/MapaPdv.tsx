import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

// =====================================================================
// Mapa de puntos de venta
//
// Dos usos con el mismo componente:
//
//   · En la lista, de solo lectura: todas las tiendas con su radio de
//     check-in dibujado. Ver el circulo es la unica forma de darse
//     cuenta de que 150 metros en una plaza se come el estacionamiento
//     del vecino, o de que una tienda quedo en otra colonia porque se
//     invirtieron la latitud y la longitud.
//
//   · En el alta y la edicion, con el pin arrastrable: en vez de copiar
//     coordenadas de Google Maps se mueve el pin y los campos se llenan
//     solos. Un digito de mas en la longitud manda la tienda al mar, y
//     escribiendo no se nota; en el mapa, de inmediato.
// =====================================================================

export type PuntoMapa = {
  id: string
  codigo: string
  nombre: string
  lat: number
  lng: number
  radio: number
}

type Props = {
  puntos: PuntoMapa[]
  activo?: string | null
  altura?: number
  /** Si viene, el pin se puede arrastrar y esto devuelve la posicion. */
  onMover?: (lat: number, lng: number) => void
}

const CDMX: [number, number] = [19.4326, -99.1332]

function pin(codigo: string, activo: boolean) {
  return L.divIcon({
    className: '',
    html: `<div class="pdv-pin${activo ? ' on' : ''}"><span>${codigo}</span></div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  })
}

export default function MapaPdv({ puntos, activo, altura = 360, onMover }: Props) {
  const caja = useRef<HTMLDivElement>(null)
  const mapa = useRef<L.Map | null>(null)
  const capa = useRef<L.LayerGroup | null>(null)
  // onMover cambia en cada render del padre; guardarlo en una ref evita
  // volver a dibujar el mapa entero por eso.
  const mover = useRef(onMover)
  mover.current = onMover
  const encuadrado = useRef(false)

  useEffect(() => {
    if (!caja.current || mapa.current) return
    const m = L.map(caja.current, { center: CDMX, zoom: 11, scrollWheelZoom: false })
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; colaboradores de OpenStreetMap',
    }).addTo(m)
    capa.current = L.layerGroup().addTo(m)
    // Tocar el mapa pone el pin donde sea. Es como se ubica una tienda
    // que todavia no tiene coordenadas: no hay pin que arrastrar.
    m.on('click', e => mover.current?.(e.latlng.lat, e.latlng.lng))
    mapa.current = m
    return () => { m.remove(); mapa.current = null }
  }, [])

  useEffect(() => {
    const m = mapa.current, c = capa.current
    if (!m || !c) return
    c.clearLayers()

    const ubicados = puntos.filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng))
    if (ubicados.length === 0) return

    ubicados.forEach(p => {
      const esActivo = p.id === activo || ubicados.length === 1
      L.circle([p.lat, p.lng], {
        radius: p.radio || 0,
        color: esActivo ? '#E8622A' : '#16324F',
        weight: 1.5,
        fillColor: esActivo ? '#E8622A' : '#16324F',
        fillOpacity: 0.12,
      }).addTo(c)

      const marca = L.marker([p.lat, p.lng], {
        icon: pin(p.codigo, esActivo),
        draggable: !!mover.current,
        keyboard: true,
        title: `${p.codigo} · ${p.nombre}`,
      }).addTo(c)

      marca.bindTooltip(
        `<b>${p.codigo}</b> ${p.nombre}<br>radio ${p.radio} m`,
        { direction: 'top', offset: [0, -10] },
      )

      if (mover.current) {
        marca.on('drag', e => {
          const { lat, lng } = (e.target as L.Marker).getLatLng()
          mover.current?.(lat, lng)
        })
      }
    })

    // Con el pin arrastrable el encuadre se hace una sola vez: si se
    // recalculara en cada movimiento, el mapa perseguiria al pin y seria
    // imposible apuntar.
    if (mover.current && encuadrado.current) return
    encuadrado.current = true

    if (ubicados.length === 1) {
      const p = ubicados[0]
      m.fitBounds(L.circle([p.lat, p.lng], { radius: Math.max(p.radio, 80) * 2.2 }).getBounds())
    } else {
      m.fitBounds(L.latLngBounds(ubicados.map(p => [p.lat, p.lng] as [number, number])),
                  { padding: [36, 36], maxZoom: 16 })
    }
  }, [puntos, activo])

  // Al abrirse dentro de un panel el contenedor nace con alto cero y
  // Leaflet dibuja los mosaicos del tamano equivocado.
  useEffect(() => {
    const t = setTimeout(() => mapa.current?.invalidateSize(), 120)
    return () => clearTimeout(t)
  }, [altura])

  const sinUbicar = puntos.filter(p => !Number.isFinite(p.lat) || !Number.isFinite(p.lng)).length

  return (
    <div className="pdv-mapa">
      <div ref={caja} style={{ height: altura }} role="img"
           aria-label={`Mapa con ${puntos.length - sinUbicar} punto(s) de venta y su radio de check-in`} />
      {sinUbicar > 0 && (
        <p className="pdv-mapa-nota">
          {sinUbicar === 1
            ? 'Hay 1 punto de venta sin coordenadas, así que no aparece en el mapa.'
            : `Hay ${sinUbicar} puntos de venta sin coordenadas, así que no aparecen en el mapa.`}
        </p>
      )}
      {onMover && (
        <p className="pdv-mapa-nota">
          Toca el mapa o arrastra el pin para fijar la tienda: la latitud y la
          longitud se llenan solas. Acerca el mapa antes, para no errarle por
          media cuadra.
        </p>
      )}
    </div>
  )
}
