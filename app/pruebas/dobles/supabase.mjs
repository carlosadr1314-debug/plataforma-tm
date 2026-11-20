// Supabase de mentiras, al que se le puede decir que falle.
// Imita lo poco que usa la aplicacion: upsert con .select().single(),
// select().eq().maybeSingle(), y upsert a secas.
export const estado = {
  falla: null,
  enviados: [],          // visitas
  respuestas: [],        // filas de respuesta
  visitaPorItinerario: {},   // itinerario -> id, para el caso "ya estaba sincronizada"
}

function resultado(fila) {
  if (estado.falla) return { data: null, error: estado.falla }
  return { data: fila, error: null }
}

export const supabase = {
  from(tabla) {
    const api = {
      upsert(filas) {
        const lista = Array.isArray(filas) ? filas : [filas]
        const hecho = {
          select() { return { single: async () => {
            if (estado.falla) return { data: null, error: estado.falla }
            estado.enviados.push(...lista)
            const it = lista[0].itinerario_id
            const id = estado.visitaPorItinerario[it] ?? ('v-' + it)
            estado.visitaPorItinerario[it] = id
            return { data: { id }, error: null }
          } } },
          then(resolver) {
            if (estado.falla) return Promise.resolve({ error: estado.falla }).then(resolver)
            if (tabla === 'respuesta') estado.respuestas.push(...lista)
            else estado.enviados.push(...lista)
            return Promise.resolve({ error: null }).then(resolver)
          },
        }
        return hecho
      },
      select() {
        return {
          eq(_col, valor) {
            return { maybeSingle: async () => {
              if (estado.falla) return { data: null, error: estado.falla }
              const id = estado.visitaPorItinerario[valor] ?? null
              return { data: id ? { id } : null, error: null }
            } }
          },
          ...resultado(null),
        }
      },
    }
    return api
  },
}
