// Supabase de mentiras, al que se le puede decir que falle.
// Imita lo poco que usa la aplicacion: upsert con .select().single(),
// select().eq().maybeSingle(), y upsert a secas.
export const estado = {
  falla: null,
  enviados: [],          // visitas
  respuestas: [],        // filas de respuesta
  visitaPorItinerario: {},   // itinerario -> id, para el caso "ya estaba sincronizada"
  evidencias: [],        // filas de la tabla evidencia
  subidas: [],           // { ruta, bytes } de lo que llego al bucket
  fallaSubida: null,     // para probar la cola cuando el bucket dice que no
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
      insert(filas) {
        const lista = Array.isArray(filas) ? filas : [filas]
        return { then(resolver) {
          if (estado.falla) return Promise.resolve({ error: estado.falla }).then(resolver)
          if (tabla === 'evidencia') estado.evidencias.push(...lista)
          
          return Promise.resolve({ error: null }).then(resolver)
        } }
      },
      select() {
        return {
          eq(col, valor) {
            return { maybeSingle: async () => {
              if (estado.falla) return { data: null, error: estado.falla }
              if (tabla === 'usuario') return { data: { organizacion_id: 'org-1' }, error: null }
              if (tabla === 'evidencia' && col === 'storage_path') {
                const ya = estado.evidencias.find(e => e.storage_path === valor)
                return { data: ya ? { id: 'e-1' } : null, error: null }
              }
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

// La sesion y el perfil, para que la cola pueda resolver la empresa.
supabase.auth = {
  async getSession() {
    return { data: { session: { user: { id: 'u-1' } } } }
  },
}

// El bucket. Guarda la ruta y el tamaño, que es lo que las pruebas
// quieren mirar.
supabase.storage = {
  from(_bucket) {
    return {
      async upload(ruta, cuerpo) {
        if (estado.fallaSubida) return { data: null, error: estado.fallaSubida }
        estado.subidas.push({ ruta, bytes: cuerpo.byteLength ?? 0 })
        return { data: { path: ruta }, error: null }
      },
    }
  },
}

export function reiniciar() {
  estado.falla = null
  estado.fallaSubida = null
  estado.enviados = []
  estado.respuestas = []
  estado.evidencias = []
  estado.subidas = []
  estado.visitaPorItinerario = {}
}
