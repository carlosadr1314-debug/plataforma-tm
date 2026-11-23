import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase } from './supabase'
import { subirFotos, cuantasFotosFaltan } from './fotos'
import { filaDeRespuesta, type Pregunta, type Valor } from './reglasFormulario'

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
const LLAVE_RESPUESTAS = 'tm.respuestas.pendientes'
// Lo capturado, aparte de lo que falta por mandar. Son dos cosas
// distintas y confundirlas fue un error caro: al sincronizar se vacia
// la lista de pendientes, y si la pantalla leyera de ahi, el
// formulario se veria vacio justo despues de guardarse bien.
const LLAVE_RESP_ESTADO = 'tm.respuestas.estado'
const LLAVE_FORMULARIOS = 'tm.formularios'
const LLAVE_NOMBRE = 'tm.nombre'

export type CamposVisita = Record<string, unknown>
export type Pendientes = Record<string, CamposVisita>

/** Lo capturado de un formulario: pregunta -> tipo y valor. */
export type RespuestaLocal = { tipo: Pregunta['tipo']; valor: Valor }
export type RespuestasPorVisita = Record<string, Record<string, RespuestaLocal>>

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

/** El nombre del promotor no cambia; preguntarlo cada vez es un viaje
 *  al servidor a cambio de nada. */
export const nombreGuardado = () => leerJson<string>(LLAVE_NOMBRE, '')
export const guardarNombre = (n: string) => guardarJson(LLAVE_NOMBRE, n)

// ---------------------------------------------------------------------
// Los formularios del dia
//
// Se bajan con la ruta, de manana y con señal, no al llegar a la
// tienda. Adentro ya no hay red, y un formulario que no se pudo bajar
// deja al promotor parado sin poder capturar nada.
// ---------------------------------------------------------------------

export type Sku = {
  id: string; codigo: string; nombre: string; precio_sugerido: number | null
}
export type FormularioGuardado = { preguntas: Pregunta[]; skus: Sku[] }

export function formularioGuardado(id: string) {
  return enFila(async () => {
    const f = await leerJson<Record<string, FormularioGuardado>>(LLAVE_FORMULARIOS, {})
    return f[id] ?? null
  })
}

function guardarFormulario(id: string, datos: FormularioGuardado) {
  return enFila(async () => {
    const f = await leerJson<Record<string, FormularioGuardado>>(LLAVE_FORMULARIOS, {})
    f[id] = datos
    await guardarJson(LLAVE_FORMULARIOS, f)
  })
}

/**
 * Baja un formulario con los SKU del cliente y lo deja guardado.
 * Devuelve lo que haya: lo recien bajado, o lo guardado de antes si
 * no hubo red.
 */
export async function bajarFormulario(
  formularioId: string, clienteId: string,
): Promise<{ datos: FormularioGuardado | null; error: string | null }> {
  const [p, k] = await Promise.all([
    supabase.from('pregunta')
      .select(`id,orden,texto,tipo,obligatoria,config,
               opcion_pregunta(id,orden,texto),
               condicion_pregunta!pregunta_id(depende_de_id,operador,valor)`)
      .eq('formulario_id', formularioId).order('orden'),
    supabase.from('sku')
      .select('id,codigo,nombre,precio_sugerido,subproducto!inner(producto!inner(cliente_id))')
      .eq('subproducto.producto.cliente_id', clienteId)
      .eq('activo', true).order('codigo'),
  ])

  // condicion_pregunta apunta DOS veces a pregunta —pregunta_id y
  // depende_de_id— asi que hay que decirle a PostgREST por cual de las
  // dos se arma el anidado. Sin la pista contesta que la relacion es
  // ambigua y no trae nada.
  if (p.error || !p.data) {
    return { datos: await formularioGuardado(formularioId), error: p.error?.message ?? null }
  }

  const datos: FormularioGuardado = {
    preguntas: (p.data as any[]).map(q => ({
      ...q,
      opcion_pregunta: (q.opcion_pregunta ?? []).sort(
        (a: any, b: any) => a.orden - b.orden),
    })) as Pregunta[],
    skus: ((k.data as any[]) ?? []).map(x => ({
      id: x.id, codigo: x.codigo, nombre: x.nombre, precio_sugerido: x.precio_sugerido,
    })),
  }
  await guardarFormulario(formularioId, datos)
  return { datos, error: k.error?.message ?? null }
}

// ---------------------------------------------------------------------
// Las respuestas del formulario
// ---------------------------------------------------------------------

/**
 * Lo capturado de esa visita, haya salido o no. Lee del estado, nunca
 * de la lista de pendientes: lo entregado sigue siendo lo contestado.
 */
export function respuestasGuardadas(itinerarioId: string) {
  return enFila(async () => {
    const r = await leerJson<RespuestasPorVisita>(LLAVE_RESP_ESTADO, {})
    return r[itinerarioId] ?? {}
  })
}

/**
 * Apunta lo capturado. Se guarda en cada cambio, no al cerrar: si la
 * aplicacion se muere a media auditoria de veinticinco preguntas, el
 * promotor no las vuelve a teclear.
 */
export function apuntarRespuestas(
  itinerarioId: string, nuevas: Record<string, RespuestaLocal>,
) {
  return enFila(async () => {
    // El estado: lo que el promotor contesto. Esto no se borra al
    // sincronizar, porque sigue siendo cierto despues de mandarlo.
    const e = await leerJson<RespuestasPorVisita>(LLAVE_RESP_ESTADO, {})
    e[itinerarioId] = { ...(e[itinerarioId] ?? {}), ...nuevas }
    await guardarJson(LLAVE_RESP_ESTADO, e)

    // Y la lista de lo que falta por mandar, que si se vacia.
    const r = await leerJson<RespuestasPorVisita>(LLAVE_RESPUESTAS, {})
    r[itinerarioId] = { ...(r[itinerarioId] ?? {}), ...nuevas }
    await guardarJson(LLAVE_RESPUESTAS, r)
  })
}

/** Al cerrar la visita ya no hace falta cargar con lo capturado. */
export function olvidarRespuestas(itinerarioId: string) {
  return enFila(async () => {
    const e = await leerJson<RespuestasPorVisita>(LLAVE_RESP_ESTADO, {})
    delete e[itinerarioId]
    await guardarJson(LLAVE_RESP_ESTADO, e)
  })
}

/**
 * Intenta entregar lo pendiente. Devuelve cuantas visitas quedaron sin
 * salir: cero significa que todo llego.
 */
export function sincronizar(): Promise<number> {
  const faltan = enFila(async () => {
    const visitas = await leerJson<Pendientes>(LLAVE_PENDIENTES, {})
    const respuestas = await leerJson<RespuestasPorVisita>(LLAVE_RESPUESTAS, {})

    const itinerarios = [...new Set([...Object.keys(visitas), ...Object.keys(respuestas)])]
    if (itinerarios.length === 0) return 0

    for (const k of itinerarios) {
      // 1. La visita primero: las respuestas cuelgan de ella y sin
      //    fila no hay a que colgarlas.
      let visitaId: string | null = null

      if (visitas[k]) {
        const { data, error } = await supabase.from('visita')
          .upsert({ ...visitas[k], sincronizada_en: new Date().toISOString() },
                  { onConflict: 'itinerario_id' })
          .select('id').single()
        if (error && esDeRed(error)) break
        if (error) { delete visitas[k]; delete respuestas[k]; continue }
        visitaId = data?.id ?? null
        delete visitas[k]
      }

      if (!respuestas[k]) continue

      // 2. Si la visita ya estaba sincronizada de antes, hay que
      //    preguntar su id: el telefono solo conoce el itinerario.
      if (!visitaId) {
        const { data, error } = await supabase.from('visita')
          .select('id').eq('itinerario_id', k).maybeSingle()
        if (error && esDeRed(error)) break
        visitaId = data?.id ?? null
        // Sin visita no hay donde poner las respuestas. Se quedan
        // esperando a que la llegada salga.
        if (!visitaId) continue
      }

      const filas = Object.entries(respuestas[k]).map(([preguntaId, r]) => ({
        visita_id: visitaId,
        ...filaDeRespuesta({ id: preguntaId, tipo: r.tipo } as Pregunta, r.valor),
      }))

      const { error } = await supabase.from('respuesta')
        .upsert(filas, { onConflict: 'visita_id,pregunta_id' })
      if (error && esDeRed(error)) break
      delete respuestas[k]
    }

    await guardarJson(LLAVE_PENDIENTES, visitas)
    await guardarJson(LLAVE_RESPUESTAS, respuestas)

    return Object.keys(visitas).length + Object.keys(respuestas).length
  })
  // Las fotos van DESPUES y fuera del candado, por dos razones. Una:
  // la ruta dentro del bucket lleva el id de la visita, asi que la
  // visita tiene que existir primero. Dos: subir una foto tarda, y
  // adentro del candado dejaba esperando a cualquier guardado de la
  // pantalla —el boton de terminar visita se quedaba girando.
  return faltan.then(async n => {
    let fotos = 0
    try { fotos = await subirFotos() } catch { fotos = await cuantasFotosFaltan() }
    return n + fotos
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
