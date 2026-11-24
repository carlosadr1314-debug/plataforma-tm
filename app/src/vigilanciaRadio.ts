import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase } from './supabase'
import { metrosEntre, sigueFuera } from './radio'

// =====================================================================
// Salirse del punto de venta con la visita abierta
//
// El radio servia para dejar o no INICIAR la visita. Despues de eso
// nadie miraba: un promotor podia marcar llegada y irse, y el rastreo
// guardaba los puntos sin que nadie los comparara contra la tienda.
//
// Esto lo mira. Se engancha al mismo flujo de ubicacion de la jornada
// —no abre un segundo GPS— y cuando detecta que se alejo:
//
//   · Le avisa al promotor. Primero a el: la mayoria de las veces es
//     un mandado de cinco minutos y basta con recordarselo.
//   · Deja un renglon para la oficina, con cuando se fue, cuando
//     volvio y que tan lejos llego.
//
// Como todo lo demas, primero se escribe en el telefono y se manda
// despues: salirse del radio suele pasar justo donde no hay señal.
// =====================================================================

const LLAVE_ALERTAS = 'tm.alertas.radio'

export type AlertaLocal = {
  itinerario_id: string
  salio_en: string
  volvio_en: string | null
  distancia_max: number
  lat: number | null
  lng: number | null
}

/** La visita abierta ahora mismo, contra la que se mide. */
type Vigilada = {
  itinerarioId: string
  lat: number
  lng: number
  radio: number
}

let vigilada: Vigilada | null = null
let fuera = false
let alertaEnCurso: string | null = null      // salio_en de la que esta abierta

/** Se avisa al promotor por fuera, para no meter notificaciones aqui. */
let avisar: ((metros: number) => void) | null = null
export function alSalirse(fn: ((metros: number) => void) | null) { avisar = fn }

let fila: Promise<unknown> = Promise.resolve()
function enFila<T>(tarea: () => Promise<T>): Promise<T> {
  const r = fila.then(tarea, tarea)
  fila = r.catch(() => {})
  return r
}

async function leer(): Promise<Record<string, AlertaLocal>> {
  try {
    const crudo = await AsyncStorage.getItem(LLAVE_ALERTAS)
    return crudo ? JSON.parse(crudo) : {}
  } catch { return {} }
}

async function guardar(l: Record<string, AlertaLocal>) {
  try { await AsyncStorage.setItem(LLAVE_ALERTAS, JSON.stringify(l)) } catch { /* ni modo */ }
}

const llave = (itinerarioId: string, salioEn: string) => `${itinerarioId}|${salioEn}`

/**
 * Empieza a vigilar una visita. Una tienda sin coordenadas o sin radio
 * no se vigila: no hay contra que medir, y medir contra nada daria
 * alertas inventadas.
 */
export function vigilar(v: {
  itinerarioId: string
  lat: number | null | undefined
  lng: number | null | undefined
  radio: number | null | undefined
}) {
  if (v.lat == null || v.lng == null || !v.radio) { soltar(); return }
  vigilada = { itinerarioId: v.itinerarioId, lat: v.lat, lng: v.lng, radio: v.radio }
  fuera = false
  alertaEnCurso = null
}

/** Se deja de vigilar: la visita se cerro o se salio de la pantalla. */
export function soltar() {
  if (alertaEnCurso && vigilada) {
    // Cerrar la visita estando lejos no borra la salida: se cierra con
    // la hora de ahora, que es lo que de verdad paso.
    const k = llave(vigilada.itinerarioId, alertaEnCurso)
    enFila(async () => {
      const l = await leer()
      if (l[k] && !l[k].volvio_en) { l[k].volvio_en = new Date().toISOString(); await guardar(l) }
    }).catch(() => {})
  }
  vigilada = null
  fuera = false
  alertaEnCurso = null
}

export const estaVigilando = () => vigilada?.itinerarioId ?? null

/**
 * Se llama con cada punto de ubicacion de la jornada. Devuelve la
 * distancia medida, o null si no hay nada que vigilar.
 */
export function revisar(pos: {
  coords: { latitude: number; longitude: number; accuracy?: number | null }
}): number | null {
  const v = vigilada
  if (!v) return null

  const metros = metrosEntre(pos.coords.latitude, pos.coords.longitude, v.lat, v.lng)
  const margen = Math.round(pos.coords.accuracy ?? 0)
  const ahoraFuera = sigueFuera(metros, margen, v.radio, fuera)

  if (ahoraFuera && !fuera) {
    // Se acaba de ir.
    const salioEn = new Date().toISOString()
    fuera = true
    alertaEnCurso = salioEn
    const k = llave(v.itinerarioId, salioEn)
    enFila(async () => {
      const l = await leer()
      l[k] = {
        itinerario_id: v.itinerarioId,
        salio_en: salioEn,
        volvio_en: null,
        distancia_max: metros,
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
      }
      await guardar(l)
    }).catch(() => {})
    avisar?.(metros)
  } else if (ahoraFuera && fuera && alertaEnCurso) {
    // Sigue afuera: solo interesa hasta donde llego.
    const k = llave(v.itinerarioId, alertaEnCurso)
    enFila(async () => {
      const l = await leer()
      if (l[k] && metros > l[k].distancia_max) { l[k].distancia_max = metros; await guardar(l) }
    }).catch(() => {})
  } else if (!ahoraFuera && fuera && alertaEnCurso) {
    // Volvio.
    const k = llave(v.itinerarioId, alertaEnCurso)
    const volvioEn = new Date().toISOString()
    fuera = false
    alertaEnCurso = null
    enFila(async () => {
      const l = await leer()
      if (l[k]) { l[k].volvio_en = volvioEn; await guardar(l) }
    }).catch(() => {})
  }

  return metros
}

/**
 * Entrega lo que no ha salido. Devuelve cuantas quedaron pendientes.
 *
 * Se manda con upsert porque una alerta abierta se reenvia en cada
 * corrida —la distancia maxima va creciendo— y reenviarla tiene que
 * actualizar, no duplicar. El indice unico de la base es (itinerario,
 * salio_en), que es justo el par que la identifica.
 */
export function sincronizarAlertas(): Promise<number> {
  return enFila(async () => {
    const l = await leer()
    const claves = Object.keys(l)
    if (claves.length === 0) return 0

    const { error } = await supabase.from('alerta_radio')
      .upsert(Object.values(l), { onConflict: 'itinerario_id,salio_en' })

    if (error) return claves.length            // sin red: se reintenta

    // Solo se sueltan las cerradas. Las abiertas se quedan porque
    // todavia les falta la hora de regreso y la distancia final.
    for (const k of claves) if (l[k].volvio_en) delete l[k]
    await guardar(l)
    return Object.keys(l).length
  })
}

/** Lo que el promotor no ha entregado, para poder decirselo. */
export async function alertasPendientes(): Promise<number> {
  return Object.keys(await enFila(leer)).length
}
