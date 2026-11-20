// Intercepta dos importaciones y las manda a los dobles, y le pone la
// extension .ts a las relativas: el codigo de la aplicacion las
// escribe sin extension porque Metro las resuelve solo, y Node no.
const AQUI = new URL('./', import.meta.url)
const DOBLES = {
  '@react-native-async-storage/async-storage': new URL('dobles/almacen.mjs', AQUI).href,
  './supabase': new URL('dobles/supabase.mjs', AQUI).href,
}

export async function resolve(especificador, contexto, siguiente) {
  const doble = DOBLES[especificador]
  if (doble) return { url: doble, shortCircuit: true }

  try {
    return await siguiente(especificador, contexto)
  } catch (e) {
    if (especificador.startsWith('.') && !/\.[a-z]+$/i.test(especificador)) {
      return await siguiente(especificador + '.ts', contexto)
    }
    throw e
  }
}
