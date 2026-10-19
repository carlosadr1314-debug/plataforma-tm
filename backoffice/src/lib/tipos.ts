export const TIPOS: Record<string, string> = {
  texto: 'Texto libre',
  numero: 'Numero',
  booleano: 'Si / No',
  opcion_unica: 'Opcion unica',
  opcion_multiple: 'Opcion multiple',
  fecha: 'Fecha',
  foto: 'Fotografia',
  precio_sku: 'Precio por SKU',
  existencia_sku: 'Existencia por SKU',
  firma: 'Firma',
  codigo_barras: 'Codigo de barras',
}

export const CON_OPCIONES = ['opcion_unica', 'opcion_multiple']
export const CON_SKU = ['precio_sku', 'existencia_sku']

export const OPERADORES: Record<string, string> = {
  igual: 'es igual a',
  distinto: 'es distinto de',
  mayor: 'es mayor que',
  menor: 'es menor que',
  contiene: 'contiene',
  vacio: 'esta vacia',
  no_vacio: 'no esta vacia',
}
