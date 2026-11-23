// =====================================================================
// Las reglas del formulario
//
// Aparte de la pantalla y sin importar nada, por lo mismo que
// radio.ts: son las reglas que deciden si una visita se puede cerrar,
// y hay que poder probarlas sin levantar React Native.
//
// Dos cosas viven aqui: cuando se muestra una pregunta condicional, y
// cuando una respuesta cuenta como contestada.
// =====================================================================

export type TipoPregunta =
  | 'texto' | 'numero' | 'booleano' | 'opcion_unica' | 'opcion_multiple'
  | 'fecha' | 'foto' | 'precio_sku' | 'existencia_sku'
  | 'firma' | 'codigo_barras'

export type Operador =
  | 'igual' | 'distinto' | 'mayor' | 'menor' | 'contiene' | 'vacio' | 'no_vacio'

export type Condicion = {
  depende_de_id: string
  operador: Operador
  valor: unknown
}

export type Opcion = { id: string; orden: number; texto: string }

export type Pregunta = {
  id: string
  orden: number
  texto: string
  tipo: TipoPregunta
  obligatoria: boolean
  config: Record<string, unknown>
  opcion_pregunta: Opcion[]
  condicion_pregunta: Condicion[]
}

/**
 * El valor de una respuesta en el telefono. Para las preguntas por SKU
 * es un mapa de sku a valor, porque la base guarda una sola fila por
 * pregunta —unique (visita_id, pregunta_id)— y los SKU de un cliente
 * cambian con el tiempo.
 */
export type Valor =
  | string | number | boolean | null
  | string[]                            // opcion_multiple
  | Record<string, number | boolean>    // precio_sku / existencia_sku

export type Respuestas = Record<string, Valor>

const vacio = (v: Valor | undefined) =>
  v === undefined || v === null || v === '' ||
  (Array.isArray(v) && v.length === 0) ||
  (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0)

/** Compara como lo haria una persona: "3" y 3 son lo mismo. */
function iguales(a: unknown, b: unknown) {
  if (a === b) return true
  if (a == null || b == null) return false
  return String(a) === String(b)
}

function cumpleUna(c: Condicion, respuestas: Respuestas): boolean {
  const v = respuestas[c.depende_de_id]
  switch (c.operador) {
    case 'vacio':    return vacio(v)
    case 'no_vacio': return !vacio(v)
    case 'igual':
      // En opcion_multiple "igual" quiere decir que esa opcion esta
      // entre las elegidas: es lo que espera quien arma el formulario.
      if (Array.isArray(v)) return v.some(x => iguales(x, c.valor))
      return iguales(v, c.valor)
    case 'distinto':
      if (Array.isArray(v)) return !v.some(x => iguales(x, c.valor))
      return !iguales(v, c.valor)
    case 'mayor':  return Number(v) > Number(c.valor)
    case 'menor':  return Number(v) < Number(c.valor)
    case 'contiene':
      if (Array.isArray(v)) return v.some(x => iguales(x, c.valor))
      return String(v ?? '').toLowerCase().includes(String(c.valor ?? '').toLowerCase())
    default: return true
  }
}

/**
 * Si la pregunta se muestra. Varias condiciones se exigen todas: la
 * pregunta aparece cuando se cumplen todas, no cuando se cumple
 * alguna. Es lo que espera quien las captura una por una.
 */
export function seMuestra(p: Pregunta, respuestas: Respuestas): boolean {
  const cs = p.condicion_pregunta ?? []
  if (cs.length === 0) return true
  return cs.every(c => cumpleUna(c, respuestas))
}

/**
 * Si una pregunta visible y obligatoria ya quedo contestada. Las de
 * por SKU piden todos los SKU de la lista: media tabla llena no es una
 * auditoria, y es el error mas facil de cometer con el telefono en una
 * mano.
 */
export function contestada(
  p: Pregunta, valor: Valor | undefined, skus: string[],
  fotos: Record<string, number> = {},
): boolean {
  // Las fotos no viven en respuesta sino en evidencia, cada una su
  // propio renglon: una pregunta de foto puede llevar varias. Lo que
  // cuenta aqui es si ya hay al menos una, tomada o subida.
  if (p.tipo === 'foto') return (fotos[p.id] ?? 0) > 0

  if (p.tipo === 'precio_sku' || p.tipo === 'existencia_sku') {
    if (skus.length === 0) return true          // cliente sin catalogo
    const m = (valor ?? {}) as Record<string, unknown>
    return skus.every(id => m[id] !== undefined && m[id] !== null && m[id] !== '')
  }
  // Un "no" es una respuesta; false no es vacio.
  if (typeof valor === 'boolean') return true
  return !vacio(valor)
}

/** Las que faltan para poder cerrar la visita. */
export function pendientes(
  preguntas: Pregunta[], respuestas: Respuestas, skus: string[],
  fotos: Record<string, number> = {},
): Pregunta[] {
  return preguntas.filter(p =>
    p.obligatoria && seMuestra(p, respuestas) &&
    !contestada(p, respuestas[p.id], skus, fotos))
}

/** Lo que va a cada columna de la tabla respuesta, segun el tipo. */
export function filaDeRespuesta(p: Pregunta, valor: Valor) {
  const base = {
    pregunta_id: p.id,
    valor_texto: null as string | null,
    valor_numero: null as number | null,
    valor_bool: null as boolean | null,
    valor_fecha: null as string | null,
    valor_opcion: null as unknown,
  }
  switch (p.tipo) {
    case 'booleano':
      return { ...base, valor_bool: valor as boolean }
    case 'numero':
      return { ...base, valor_numero: Number(valor) }
    case 'fecha':
      return { ...base, valor_fecha: valor as string }
    case 'opcion_unica':
      // Se guarda como lista de uno para que la consola lea igual las
      // de una y las de varias.
      return { ...base, valor_opcion: valor == null ? null : [valor] }
    case 'opcion_multiple':
      return { ...base, valor_opcion: valor }
    case 'precio_sku':
    case 'existencia_sku':
      return { ...base, valor_opcion: valor }
    default:
      return { ...base, valor_texto: valor == null ? null : String(valor) }
  }
}

/** Los tipos que la aplicacion todavia no sabe capturar. */
export const SIN_SOPORTE: TipoPregunta[] = ['firma', 'codigo_barras']
export const soportada = (t: TipoPregunta) => !SIN_SOPORTE.includes(t)
