import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase } from './supabase'

// =====================================================================
// Cola de puntos sin enviar
//
// En una tienda dentro de una plaza no hay senal, y ahi es justo donde
// esta el promotor. Cada punto se guarda primero en el telefono y se
// manda despues; si el envio falla se queda en la cola y se reintenta.
//
// El envio usa upsert contra el indice (jornada_id, capturada_en), que
// es la llave de sincronizacion: reenviar un bloque que ya habia
// llegado no duplica nada. Por eso se puede reintentar sin miedo.
// =====================================================================

export type Punto = {
  jornada_id: string
  usuario_id: string
  organizacion_id: string
  lat: number
  lng: number
  precision_m: number | null
  velocidad_kmh: number | null
  rumbo: number | null
  bateria: number | null
  ubicacion_simulada: boolean
  capturada_en: string
}

const LLAVE = 'tm.cola'

// Un dia largo capturando cada minuto son unos 900 puntos. El tope
// deja margen de sobra y evita que un telefono sin senal durante dias
// se llene. Al pasarse se tiran los mas viejos: el rastro reciente
// vale mas que el de anteayer.
const TOPE = 3000

// Cuantos se mandan por viaje. Bloques chicos para que una conexion
// mala alcance a entregar algo en vez de fallar entera.
const BLOQUE = 150

// AsyncStorage no es transaccional: si la captura y el envio leen y
// escriben a la vez, uno pisa al otro y se pierden puntos. Todas las
// operaciones pasan por esta fila.
let fila: Promise<unknown> = Promise.resolve()
function enFila<T>(tarea: () => Promise<T>): Promise<T> {
  const resultado = fila.then(tarea, tarea)
  fila = resultado.catch(() => {})
  return resultado
}

async function leer(): Promise<Punto[]> {
  try {
    const crudo = await AsyncStorage.getItem(LLAVE)
    return crudo ? (JSON.parse(crudo) as Punto[]) : []
  } catch {
    return []
  }
}

async function escribir(puntos: Punto[]) {
  try {
    await AsyncStorage.setItem(LLAVE, JSON.stringify(puntos))
  } catch {
    // Si no se puede guardar, el punto se pierde. Es preferible eso a
    // tumbar la captura.
  }
}

export function encolar(p: Punto): Promise<number> {
  return enFila(async () => {
    const puntos = await leer()
    puntos.push(p)
    const recortados = puntos.length > TOPE ? puntos.slice(-TOPE) : puntos
    await escribir(recortados)
    return recortados.length
  })
}

export function cuantosPendientes(): Promise<number> {
  return enFila(async () => (await leer()).length)
}

/**
 * Intenta entregar lo que haya en la cola. Devuelve cuantos quedaron
 * pendientes: cero significa que todo llego.
 */
export function vaciar(): Promise<number> {
  return enFila(async () => {
    let puntos = await leer()

    while (puntos.length > 0) {
      const lote = puntos.slice(0, BLOQUE)
      const { error } = await supabase.from('ubicacion')
        .upsert(lote, { onConflict: 'jornada_id,capturada_en', ignoreDuplicates: true })

      // Sin senal o con el servidor caido: se deja la cola como esta y
      // se reintenta en el siguiente ciclo.
      if (error) return puntos.length

      puntos = puntos.slice(lote.length)
      await escribir(puntos)
    }

    return 0
  })
}
