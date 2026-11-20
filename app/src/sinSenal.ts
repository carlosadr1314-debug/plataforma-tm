import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase } from './supabase'

// =====================================================================
// Trabajar sin señal
//
// El promotor pierde la señal justo donde la necesita: adentro de la
// tienda, en una plaza, en un sotano. Si la aplicacion depende de la
// red para registrar una llegada, no sirve.
//
// Dos cosas viven aqui:
//
//   · La ruta del dia guardada. Se refresca cada vez que hay red, y
//     es lo que se pinta cuando no la hay. Sin esto, abrir la
//     aplicacion sin señal muestra una pantalla vacia y el promotor no
//     sabe ni a donde iba.
//
//   · Los cambios de visita que no han salido. Todo lo que el promotor
//     hace —llegar, cerrar, marcar no realizada— se escribe PRIMERO
//     aqui y se manda despues. Nunca al reves: si se mandara primero y
//     la red tarda doce segundos en fallar, el promotor se queda
//     mirando una rueda girar con el gerente esperandolo.
//
// Los cambios de una misma visita se funden en un solo registro, no se
// encolan uno tras otro. La tabla visita tiene una fila por itinerario
// y el upsert manda el estado final: llegada + cierre fundidos son una
// sola escritura, y reenviarla no hace daño.
// =====================================================================

const LLAVE_RUTA = 'tm.ruta'
const LLAVE_PENDIENTES = 'tm.visitas.pendientes'

export type CamposVisita = Record<string, unknown>
export type Pendientes = Record<string, CamposVisita>

// AsyncStorage no es transaccional: la pantalla y el sincronizador
// escriben en la misma llave y se pisarian.
let fila: Promise<unknown> = Promise.resolve()
function enFila<T>(tarea: () => Promise<T>): Promise<T> {
  const r = fila.then(tarea, tarea)
  fila = r.catch(() => {})
  return r
}

async function leerJson<T>(llave: string, siNada: T): Promise<T> {
  try {
    const crudo = await AsyncStorage.getItem(llave)
    return crudo ? (JSON.parse(crudo) as T) : siNada
  } catch {
    return siNada
  }
}

async function guardarJson(llave: string, valor: unknown) {
  try { await AsyncStorage.setItem(llave, JSON.stringify(valor)) } catch { /* ni modo */ }
}

// ---------------------------------------------------------------------
// La ruta del dia
// ---------------------------------------------------------------------

export function guardarRuta(fecha: string, paradas: unknown[]) {
  return guardarJson(LLAVE_RUTA, { fecha, paradas, guardada_en: new Date().toISOString() })
}

/** Devuelve la ruta guardada solo si es la de hoy: una de ayer confunde más que ayuda. */
export async function rutaGuardada(fecha: string) {
  const r = await leerJson<{ fecha: string; paradas: unknown[]; guardada_en: string } | null>(
    LLAVE_RUTA, null)
  return r && r.fecha === fecha ? r : null
}

// ---------------------------------------------------------------------
// Los cambios que no han salido
// ---------------------------------------------------------------------

export function pendientes(): Promise<Pendientes> {
  return enFila(() => leerJson<Pendientes>(LLAVE_PENDIENTES, {}))
}

/**
 * Apunta un cambio de visita. Se funde con lo que ya hubiera pendiente
 * de esa misma visita, de modo que lo guardado siempre es el estado
 * completo que hay que mandar.
 */
export function apuntar(itinerarioId: string, campos: CamposVisita): Promise<Pendientes> {
  return enFila(async () => {
    const p = await leerJson<Pendientes>(LLAVE_PENDIENTES, {})
    p[itinerarioId] = { ...(p[itinerarioId] ?? {}), ...campos, itinerario_id: itinerarioId }
    await guardarJson(LLAVE_PENDIENTES, p)
    return p
  })
}

/**
 * Intenta entregar lo pendiente. Devuelve cuantas visitas quedaron sin
 * salir: cero significa que todo llego.
 */
export function sincronizar(): Promise<number> {
  return enFila(async () => {
    const p = await leerJson<Pendientes>(LLAVE_PENDIENTES, {})
    const llaves = Object.keys(p)
    if (llaves.length === 0) return 0

    for (const k of llaves) {
      const { error } = await supabase.from('visita')
        .upsert({ ...p[k], sincronizada_en: new Date().toISOString() },
                { onConflict: 'itinerario_id' })

      // Sin red: se corta y se reintenta despues, sin perder nada.
      if (error && esDeRed(error)) break

      // Un error que no es de red —una visita borrada en la oficina,
      // un permiso retirado— no se arregla reintentando. Se suelta
      // para que lo demas pueda salir.
      delete p[k]
    }

    await guardarJson(LLAVE_PENDIENTES, p)
    return Object.keys(p).length
  })
}

// supabase-js no distingue "no hubo red" de "el servidor dijo que no",
// asi que se mira el mensaje. Ante la duda se trata como red y se
// reintenta: perder un registro es peor que intentarlo de mas.
function esDeRed(error: { message?: string; code?: string }) {
  const m = (error.message ?? '').toLowerCase()
  if (m.includes('duplicate') || m.includes('violates') ||
      m.includes('row-level security') || m.includes('policy') ||
      m.includes('invalid input')) return false
  return true
}
