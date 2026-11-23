import AsyncStorage from '@react-native-async-storage/async-storage'
import * as ImagePicker from 'expo-image-picker'
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator'
import { File, Directory, Paths } from 'expo-file-system'
import { supabase } from './supabase'

// =====================================================================
// Evidencia fotografica
//
// La foto es lo que la marca paga por ver, asi que el camino de la
// camara al servidor no puede depender de que haya señal en el momento
// del disparo. Adentro de una tienda casi nunca la hay.
//
// Como funciona:
//
//   1. Se toma con la camara. No se abre la galeria: una foto de la
//      galeria pudo tomarse en otro lado y otro dia, y entonces la
//      evidencia no prueba nada.
//   2. Se reduce a 1280 px de lado largo y se guarda como JPEG. Una
//      foto de celular pesa 4 MB; asi queda en 200-300 KB. Con datos
//      moviles en una tienda eso es la diferencia entre subir y no.
//   3. El archivo se mueve a una carpeta propia en el almacenamiento
//      permanente. La camara lo deja en la cache, y la cache el
//      sistema la puede vaciar cuando quiera: si la foto espera ahi a
//      que vuelva la señal, se pierde.
//   4. Se apunta en una lista pendiente y se intenta subir. Lo que no
//      sale se queda y se reintenta.
//
// El archivo solo se borra del telefono cuando el servidor confirmo
// que lo recibio. Mientras tanto ocupa espacio, y eso esta bien: es
// mas barato que perder la evidencia de una jornada.
// =====================================================================

const LLAVE_FOTOS = 'tm.fotos.pendientes'
const CARPETA = 'evidencia'
const LADO_LARGO = 1280
const CALIDAD = 0.6
/** Supabase rechaza arriba de 5 MB. Si una foto reducida llega ahi, algo salio mal. */
const TOPE_BYTES = 5 * 1024 * 1024

export type FotoPendiente = {
  /** Lo genera el telefono: es el nombre del archivo y la llave de la lista. */
  id: string
  itinerario_id: string
  pregunta_id: string | null
  cliente_id: string
  archivo: string          // uri del archivo ya reducido, en carpeta permanente
  bytes: number
  lat: number | null
  lng: number | null
  tomada_en: string
  intentos: number
  /**
   * Si el servidor ya la recibio. El apunte NO se borra al subir: una
   * foto entregada sigue siendo evidencia tomada, y si desapareciera
   * de la pantalla el promotor creeria que la perdio —y una pregunta
   * de foto obligatoria volveria a contar como sin contestar, dejando
   * la visita sin poder cerrarse.
   */
  subida: boolean
}

type Lista = Record<string, FotoPendiente>

// Misma fila que en sinSenal: la pantalla y el sincronizador escriben
// en la misma llave y se pisarian.
let fila: Promise<unknown> = Promise.resolve()
function enFila<T>(tarea: () => Promise<T>): Promise<T> {
  const r = fila.then(tarea, tarea)
  fila = r.catch(() => {})
  return r
}

async function leer(): Promise<Lista> {
  try {
    const crudo = await AsyncStorage.getItem(LLAVE_FOTOS)
    return crudo ? (JSON.parse(crudo) as Lista) : {}
  } catch { return {} }
}

async function guardar(l: Lista) {
  try { await AsyncStorage.setItem(LLAVE_FOTOS, JSON.stringify(l)) } catch { /* ni modo */ }
}

function carpeta(): Directory {
  const d = new Directory(Paths.document, CARPETA)
  if (!d.exists) d.create({ intermediates: true })
  return d
}

// ---------------------------------------------------------------------
// Tomar la foto
// ---------------------------------------------------------------------

export type ResultadoFoto =
  | { ok: true; foto: FotoPendiente }
  | { ok: false; cancelada: boolean; error: string }

/** Pide el permiso de camara. Se llama antes de abrirla, no al arrancar. */
export async function permisoCamara(): Promise<boolean> {
  const actual = await ImagePicker.getCameraPermissionsAsync()
  if (actual.granted) return true
  if (!actual.canAskAgain) return false
  const pedido = await ImagePicker.requestCameraPermissionsAsync()
  return pedido.granted
}

export async function tomarFoto(datos: {
  itinerarioId: string
  preguntaId: string | null
  clienteId: string
  lat?: number | null
  lng?: number | null
}): Promise<ResultadoFoto> {
  if (!(await permisoCamara()))
    return { ok: false, cancelada: false,
      error: 'La aplicación necesita permiso para usar la cámara. Actívalo en los ajustes del teléfono.' }

  let tomada: ImagePicker.ImagePickerResult
  try {
    tomada = await ImagePicker.launchCameraAsync({
      // Sin recorte: el promotor trae el telefono en una mano y el
      // lector en la otra, y cada toque de mas es tiempo en la tienda.
      allowsEditing: false,
      quality: 1,          // se comprime despues, con el tamaño ya reducido
      exif: false,
    })
  } catch {
    return { ok: false, cancelada: false, error: 'No se pudo abrir la cámara.' }
  }
  if (tomada.canceled || !tomada.assets?.length)
    return { ok: false, cancelada: true, error: '' }

  const origen = tomada.assets[0]

  try {
    // El lado largo es el que se limita, se tome de pie o acostada.
    const vertical = (origen.height ?? 0) > (origen.width ?? 0)
    const ctx = ImageManipulator.manipulate(origen.uri)
    ctx.resize(vertical ? { height: LADO_LARGO } : { width: LADO_LARGO })
    const render = await ctx.renderAsync()
    const chica = await render.saveAsync({ compress: CALIDAD, format: SaveFormat.JPEG })

    const id = nuevoId()
    const destino = new File(carpeta(), `${id}.jpg`)
    await new File(chica.uri).move(destino)

    const bytes = destino.info().size ?? 0
    if (bytes > TOPE_BYTES) {
      destino.delete()
      return { ok: false, cancelada: false,
        error: 'La foto quedó demasiado pesada. Inténtalo otra vez.' }
    }

    const foto: FotoPendiente = {
      id,
      itinerario_id: datos.itinerarioId,
      pregunta_id: datos.preguntaId,
      cliente_id: datos.clienteId,
      archivo: destino.uri,
      bytes,
      lat: datos.lat ?? null,
      lng: datos.lng ?? null,
      tomada_en: new Date().toISOString(),
      intentos: 0,
      subida: false,
    }

    await enFila(async () => {
      const l = await leer()
      l[id] = foto
      await guardar(l)
    })

    return { ok: true, foto }
  } catch {
    return { ok: false, cancelada: false,
      error: 'No se pudo guardar la foto en el teléfono.' }
  }
}

function nuevoId() {
  // Sin dependencias: hora mas azar basta para no repetirse en un
  // telefono, y el servidor manda su propio id de todos modos.
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
}

// ---------------------------------------------------------------------
// Consultar lo pendiente
// ---------------------------------------------------------------------

export function fotosPendientes(): Promise<Lista> {
  return enFila(leer)
}

/** Las de una visita, para pintarlas en el formulario. */
export async function fotosDe(itinerarioId: string): Promise<FotoPendiente[]> {
  const l = await fotosPendientes()
  return Object.values(l)
    .filter(f => f.itinerario_id === itinerarioId)
    .sort((a, b) => a.tomada_en.localeCompare(b.tomada_en))
}

/** Quita una foto que el promotor tomo mal. Si ya subio, se queda: lo
 *  que esta en el servidor se borra desde la oficina, no desde aqui. */
export async function descartarFoto(id: string): Promise<void> {
  await enFila(async () => {
    const l = await leer()
    const f = l[id]
    if (!f || f.subida) return
    try { const a = new File(f.archivo); if (a.exists) a.delete() } catch { /* ya no estaba */ }
    delete l[id]
    await guardar(l)
  })
}

// ---------------------------------------------------------------------
// Subir
// ---------------------------------------------------------------------

/**
 * Intenta entregar las fotos pendientes. Devuelve cuantas quedaron sin
 * salir: cero significa que todas llegaron.
 *
 * Una foto no se puede subir antes que su visita, porque la ruta
 * dentro del bucket lleva el id de la visita. Si la visita todavia no
 * existe alla —el promotor trabajo sin señal— la foto espera su turno
 * en vez de perderse. Por eso esto corre despues de sincronizar().
 */
// El formulario guarda en cada cambio y cada guardado intenta
// sincronizar. Sin esto se encimarian corridas de subida sobre las
// mismas fotos.
let subiendo = false

export function subirFotos(): Promise<number> {
  if (subiendo) return cuantasFotosFaltan()
  subiendo = true
  return enFila(async () => {
    const l = await leer()
    const ids = Object.keys(l).filter(k => !l[k].subida)
    if (ids.length === 0) return 0

    // La empresa es la misma para toda la corrida y la ruta dentro del
    // bucket empieza por ella. Se resuelve aqui y no al tomar la foto:
    // tomarla tiene que funcionar sin señal, y esto necesita red.
    const organizacion = await miOrganizacion()
    if (!organizacion) return ids.length

    // El id de visita se pide una vez por itinerario, no una por foto.
    const visitas = new Map<string, string | null>()

    for (const id of ids) {
      const f = l[id]

      if (!visitas.has(f.itinerario_id)) {
        const { data, error } = await supabase.from('visita')
          .select('id').eq('itinerario_id', f.itinerario_id).maybeSingle()
        if (error) break                       // sin red: se corta y se reintenta
        visitas.set(f.itinerario_id, data?.id ?? null)
      }
      const visitaId = visitas.get(f.itinerario_id)
      if (!visitaId) continue                  // la visita aun no sale; esta espera

      const archivo = new File(f.archivo)
      if (!archivo.exists) {
        // El sistema limpio el archivo pese a todo. Reintentar algo
        // que ya no existe no lleva a ningun lado.
        delete l[id]
        continue
      }

      const ruta = `${organizacion}/${f.cliente_id}/${visitaId}/${id}.jpg`

      // En un reintento la subida pudo haber quedado a medias: el
      // archivo arriba y el renglon sin escribir.
      if (f.intentos > 0) {
        const { data: ya } = await supabase.from('evidencia')
          .select('id').eq('storage_path', ruta).maybeSingle()
        if (ya) { f.subida = true; continue }
      }

      f.intentos += 1

      const u8 = await archivo.bytes()
      const cuerpo = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer

      const { error: errSubida } = await supabase.storage
        .from('evidencia').upload(ruta, cuerpo, {
          contentType: 'image/jpeg',
          upsert: true,     // la ruta sale del id del telefono: reenviar es inofensivo
        })

      if (errSubida) {
        await guardar(l)                       // se conserva el contador de intentos
        if (esDeRed(errSubida)) break
        continue                               // permanente: las demas si pueden salir
      }

      const { error: errRenglon } = await supabase.from('evidencia').insert({
        visita_id: visitaId,
        pregunta_id: f.pregunta_id,
        storage_path: ruta,
        bytes: f.bytes,
        lat: f.lat,
        lng: f.lng,
        tomada_en: f.tomada_en,
      })

      if (errRenglon) {
        await guardar(l)
        if (esDeRed(errRenglon)) break
        continue
      }

      // No se borra el apunte: se marca. Una foto entregada sigue
      // siendo evidencia tomada, y si desapareciera de la pantalla el
      // promotor creeria que la perdio. Peor: una pregunta de foto
      // obligatoria volveria a contar como sin contestar y la visita
      // se quedaria sin poder cerrarse.
      f.subida = true
    }

    await guardar(l)
    return Object.values(l).filter(x => !x.subida).length
  }).finally(() => { subiendo = false })
}

/**
 * Se tira lo de una visita ya cerrada: los archivos ya entregados y
 * sus apuntes. Hasta ese momento la foto se queda en el telefono
 * aunque ya haya subido, para que el promotor la siga viendo mientras
 * trabaja esa visita.
 */
export function olvidarFotosDe(itinerarioId: string): Promise<void> {
  return enFila(async () => {
    const l = await leer()
    for (const [id, f] of Object.entries(l)) {
      if (f.itinerario_id !== itinerarioId || !f.subida) continue
      try { const a = new File(f.archivo); if (a.exists) a.delete() } catch { /* ya no estaba */ }
      delete l[id]
    }
    await guardar(l)
  })
}

const LLAVE_ORG = 'tm.organizacion'

/** La empresa del promotor. No cambia, asi que se guarda. */
async function miOrganizacion(): Promise<string | null> {
  try {
    const guardada = await AsyncStorage.getItem(LLAVE_ORG)
    if (guardada) return guardada
  } catch { /* sigue por la red */ }

  const { data: s } = await supabase.auth.getSession()
  const uid = s.session?.user?.id
  if (!uid) return null

  const { data } = await supabase.from('usuario')
    .select('organizacion_id').eq('id', uid).maybeSingle()
  const org = (data as { organizacion_id?: string } | null)?.organizacion_id ?? null
  if (org) { try { await AsyncStorage.setItem(LLAVE_ORG, org) } catch { /* ni modo */ } }
  return org
}

// Igual que en sinSenal: supabase-js no distingue "no hubo red" de "el
// servidor dijo que no". Ante la duda se reintenta, porque perder una
// foto es peor que intentarlo de mas.
function esDeRed(error: { message?: string; statusCode?: string }) {
  const m = (error.message ?? '').toLowerCase()
  if (m.includes('duplicate') || m.includes('violates') ||
      m.includes('row-level security') || m.includes('policy') ||
      m.includes('invalid input') || m.includes('exceeded the maximum')) return false
  return true
}

/**
 * Lo que el promotor no ha entregado, para poder decirselo. Una foto
 * atorada tiene que verse: el caso que nunca debe pasar es terminar la
 * jornada creyendo que todo salio.
 */
export async function cuantasFotosFaltan(): Promise<number> {
  const l = await fotosPendientes()
  return Object.values(l).filter(f => !f.subida).length
}
