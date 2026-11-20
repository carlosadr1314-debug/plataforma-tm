// Intercepta dos importaciones y las manda a los dobles. Todo lo demas
// sigue su camino normal.
const AQUI = new URL('./', import.meta.url)
const DOBLES = {
  '@react-native-async-storage/async-storage': new URL('dobles/almacen.mjs', AQUI).href,
  './supabase': new URL('dobles/supabase.mjs', AQUI).href,
}
export function resolve(especificador, contexto, siguiente) {
  const doble = DOBLES[especificador]
  if (doble) return { url: doble, shortCircuit: true }
  return siguiente(especificador, contexto)
}
