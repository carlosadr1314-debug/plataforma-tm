// Supabase de mentiras, al que se le puede decir que falle.
export const estado = { falla: null, enviados: [] }
export const supabase = {
  from() {
    return {
      async upsert(fila) {
        if (estado.falla) return { error: estado.falla }
        estado.enviados.push(fila)
        return { error: null }
      },
    }
  },
}
