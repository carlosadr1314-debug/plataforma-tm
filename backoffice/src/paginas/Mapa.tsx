import { useEffect, useRef, useState, useCallback } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { supabase } from '../lib/supabase'

// =====================================================================
// Seguimiento en vivo
//
// El seguimiento vive dentro de una jornada que el promotor abre y
// cierra desde la aplicacion. Aqui solo aparecen los que la traen
// abierta: si nadie la ha iniciado el mapa esta vacio, y eso es
// correcto, no una falla.
//
// La consulta no filtra por usuario. El aislamiento lo hacen las
// politicas de la base: un supervisor recibe a los de su
// organizacion y nadie mas.
// =====================================================================

type Posicion = {
  jornada_id: string
  usuario_id: string
  nombre: string
  inicio: string
  lat: number | null
  lng: number | null
  velocidad_kmh: number | null
  bateria: number | null
  ubicacion_simulada: boolean | null
  capturada_en: string | null
  minutos_sin_reportar: number | null
}

type Punto = { lat: number; lng: number; capturada_en: string }

const CDMX: [number, number] = [19.4326, -99.1332]

// Un promotor en movimiento reporta cada minuto. Tres minutos de
// silencio todavia es normal; quince ya es que algo pasa.
function estado(min: number | null) {
  if (min === null) return { texto: 'Sin reportar aún', color: '#6B6560' }
  if (min < 3)      return { texto: 'En línea',         color: '#1E7A4B' }
  if (min < 15)     return { texto: `Hace ${Math.round(min)} min`, color: '#8A3312' }
  return { texto: `Sin señal · ${Math.round(min)} min`, color: '#C0392B' }
}

const hora = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }) : '—'

const iniciales = (n: string) =>
  n.trim().split(/\s+/).slice(0, 2).map(p => p[0]).join('').toUpperCase()

// Marcador dibujado con HTML: evita el problema clasico de las
// imagenes de Leaflet que no cargan al compilar con Vite.
function marcador(p: Posicion, activo: boolean) {
  return L.divIcon({
    className: '',
    html: `<div class="seg-pin ${activo ? 'on' : ''}" style="--pin:${estado(p.minutos_sin_reportar).color}">
             <span>${iniciales(p.nombre)}</span></div>`,
    iconSize: [36, 36],
    iconAnchor: [18, 18],
  })
}

export default function Mapa() {
  const caja = useRef<HTMLDivElement>(null)
  const mapa = useRef<L.Map | null>(null)
  const capaPines = useRef<L.LayerGroup | null>(null)
  const capaRuta = useRef<L.LayerGroup | null>(null)
  const sigue = useRef(true)

  const [posiciones, setPosiciones] = useState<Posicion[]>([])
  const [elegido, setElegido] = useState<string | null>(null)
  const [recorrido, setRecorrido] = useState<Punto[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [ultima, setUltima] = useState<Date | null>(null)

  const traerPosiciones = useCallback(async () => {
    const { data, error: err } = await supabase
      .from('posicion_actual').select('*').order('nombre')
    if (err) { setError('No se pudieron cargar las posiciones. ' + err.message); return }
    setError('')
    setPosiciones((data as Posicion[]) ?? [])
    setUltima(new Date())
  }, [])

  const traerRecorrido = useCallback(async (jornadaId: string) => {
    const { data, error: err } = await supabase
      .from('ubicacion').select('lat,lng,capturada_en')
      .eq('jornada_id', jornadaId).order('capturada_en')
    if (err) { setError('No se pudo cargar el recorrido. ' + err.message); return }
    setRecorrido((data as Punto[]) ?? [])
  }, [])

  // ---- arranque del mapa -------------------------------------------
  useEffect(() => {
    if (!caja.current || mapa.current) return
    const m = L.map(caja.current, { center: CDMX, zoom: 12 })
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '&copy; colaboradores de OpenStreetMap',
    }).addTo(m)
    capaRuta.current = L.layerGroup().addTo(m)
    capaPines.current = L.layerGroup().addTo(m)
    // Si el usuario mueve el mapa, deja de reencuadrarse solo.
    m.on('dragstart zoomstart', () => { sigue.current = false })
    mapa.current = m
    return () => { m.remove(); mapa.current = null }
  }, [])

  // ---- carga, refresco y escucha en vivo ---------------------------
  useEffect(() => {
    traerPosiciones().finally(() => setCargando(false))

    // Respaldo por si Realtime no esta habilitado en el proyecto.
    const reloj = setInterval(() => { traerPosiciones() }, 30000)

    // Los puntos entran de uno en uno; se agrupan para no recargar
    // la consulta una vez por promotor por minuto.
    let pendiente: ReturnType<typeof setTimeout> | null = null
    const canal = supabase.channel('seguimiento')
      .on('postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'ubicacion' },
          () => {
            if (pendiente) return
            pendiente = setTimeout(() => { pendiente = null; traerPosiciones() }, 4000)
          })
      .subscribe()

    return () => {
      clearInterval(reloj)
      if (pendiente) clearTimeout(pendiente)
      supabase.removeChannel(canal)
    }
  }, [traerPosiciones])

  useEffect(() => {
    if (!elegido) { setRecorrido([]); return }
    const p = posiciones.find(x => x.usuario_id === elegido)
    if (p) traerRecorrido(p.jornada_id)
  }, [elegido, posiciones, traerRecorrido])

  // ---- pintar ------------------------------------------------------
  useEffect(() => {
    const m = mapa.current, capa = capaPines.current
    if (!m || !capa) return
    capa.clearLayers()

    const ubicados = posiciones.filter(p => p.lat !== null && p.lng !== null)
    for (const p of ubicados) {
      const e = estado(p.minutos_sin_reportar)
      L.marker([p.lat as number, p.lng as number],
               { icon: marcador(p, p.usuario_id === elegido) })
        .bindTooltip(
          `<strong>${p.nombre}</strong><br>${e.texto}` +
          (p.bateria !== null ? `<br>Batería ${p.bateria}%` : ''),
          { direction: 'top', offset: [0, -15] })
        .on('click', () => setElegido(p.usuario_id))
        .addTo(capa)
    }

    if (sigue.current && ubicados.length > 0) {
      m.fitBounds(
        L.latLngBounds(ubicados.map(p => [p.lat as number, p.lng as number] as [number, number])),
        { padding: [60, 60], maxZoom: 15 })
    }
  }, [posiciones, elegido])

  useEffect(() => {
    const m = mapa.current, capa = capaRuta.current
    if (!m || !capa) return
    capa.clearLayers()
    if (recorrido.length < 2) return

    const linea = recorrido.map(p => [p.lat, p.lng] as [number, number])
    // Dos trazos: uno claro y grueso debajo, para que la linea se lea
    // sobre cualquier color del mapa.
    L.polyline(linea, { color: '#FFFFFF', weight: 7, opacity: .9 }).addTo(capa)
    L.polyline(linea, { color: '#16324F', weight: 3, opacity: .95 }).addTo(capa)
    L.circleMarker(linea[0], {
      radius: 6, color: '#16324F', weight: 2, fillColor: '#FFFFFF', fillOpacity: 1,
    }).bindTooltip('Inicio de jornada ' + hora(recorrido[0].capturada_en)).addTo(capa)
  }, [recorrido])

  function centrar(p: Posicion) {
    setElegido(p.usuario_id)
    sigue.current = false
    if (p.lat !== null && p.lng !== null) mapa.current?.setView([p.lat, p.lng], 16)
  }

  function verTodos() {
    sigue.current = true
    setElegido(null)
    traerPosiciones()
  }

  const enLinea = posiciones.filter(p => (p.minutos_sin_reportar ?? 999) < 3).length

  return (
    <div className="seg">
      <div className="tope">
        <div>
          <h2 className="disp">Seguimiento en vivo</h2>
          <p>
            {cargando ? 'Cargando…'
              : posiciones.length === 0 ? 'Sin jornadas abiertas'
              : `${posiciones.length} en jornada · ${enLinea} reportando ahora`}
            {ultima && !cargando && ` · actualizado ${hora(ultima.toISOString())}`}
          </p>
        </div>
        <button className="btn sec" onClick={verTodos}>Ver a todos</button>
      </div>

      {error !== '' && <div className="aviso">{error}</div>}

      <div className="seg-cuerpo">
        <aside className="seg-lista">
          {!cargando && posiciones.length === 0 && (
            <div className="seg-vacio">
              <h3 className="disp">Nadie en ruta</h3>
              <p>
                Aquí aparecen los promotores que iniciaron su jornada desde la
                aplicación. Mientras nadie la abra, el mapa permanece vacío.
              </p>
            </div>
          )}

          {posiciones.map(p => {
            const e = estado(p.minutos_sin_reportar)
            return (
              <button
                key={p.usuario_id}
                className={'seg-ficha' + (p.usuario_id === elegido ? ' on' : '')}
                style={{ borderLeftColor: e.color }}
                onClick={() => centrar(p)}>
                <b>{p.nombre}</b>
                <span className="estado" style={{ color: e.color }}>{e.texto}</span>
                <span className="datos">
                  Desde {hora(p.inicio)}
                  {p.bateria !== null && ` · ${p.bateria}% batería`}
                  {p.velocidad_kmh !== null && p.velocidad_kmh > 3 &&
                    ` · ${Math.round(p.velocidad_kmh)} km/h`}
                </span>
                {p.ubicacion_simulada && <span className="simulada">Ubicación simulada</span>}
              </button>
            )
          })}
        </aside>

        <div className="seg-lienzo">
          <div ref={caja} className="seg-mapa" />
          {elegido && recorrido.length > 1 && (
            <div className="seg-pie num">
              Recorrido desde {hora(recorrido[0].capturada_en)} · {recorrido.length} puntos
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
