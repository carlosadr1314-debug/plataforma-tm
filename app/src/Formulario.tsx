import { useEffect, useMemo, useState } from 'react'
import {
  View, Text, TextInput, Pressable, StyleSheet, ScrollView, ActivityIndicator,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import {
  bajarFormulario, formularioGuardado, apuntarRespuestas, respuestasGuardadas,
  sincronizar, type FormularioGuardado, type Sku,
} from './sinSenal'
import {
  seMuestra, pendientes as faltantes, soportada,
  type Pregunta, type Respuestas, type Valor,
} from './reglasFormulario'
import { c, f, CIFRAS, TOCABLE } from './tema'

// =====================================================================
// La captura del formulario
//
// Se guarda en cada cambio, no al final: una auditoria son
// veinticinco preguntas y si la aplicacion se muere a la veinte, el
// promotor no las vuelve a teclear. Lo guardado vive en el telefono y
// sale solo cuando hay red.
//
// Las preguntas se agrupan por bloque —llegada, disponibilidad,
// precio…— porque veinticinco seguidas sin separacion son un muro, y
// porque el promotor recorre la tienda por zonas, no por numero de
// pregunta.
// =====================================================================

type Props = {
  itinerarioId: string
  formularioId: string
  clienteId: string
  onCerrar: () => void
}

export default function Formulario({ itinerarioId, formularioId, clienteId, onCerrar }: Props) {
  const [datos, setDatos] = useState<FormularioGuardado | null>(null)
  const [respuestas, setRespuestas] = useState<Respuestas>({})
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let vivo = true
    ;(async () => {
      // Lo guardado primero: es instantaneo y funciona sin red. La
      // bajada refresca despues, por si la oficina movio el formulario.
      const guardado = await formularioGuardado(formularioId)
      if (vivo && guardado) setDatos(guardado)

      const previas = await respuestasGuardadas(itinerarioId)
      if (vivo) {
        const r: Respuestas = {}
        Object.entries(previas).forEach(([k, v]) => { r[k] = v.valor })
        setRespuestas(r)
      }

      const r = await bajarFormulario(formularioId, clienteId)
        .catch(e => ({ datos: null, error: String(e?.message ?? e) }))
      if (!vivo) return
      if (r.datos) setDatos(r.datos)
      if (!guardado && !r.datos) {
        // El mensaje del servidor va tal cual: un "no se pudo" a secas
        // obliga a adivinar, y adivinar cuesta un viaje a la tienda.
        setError('No se pudo cargar el formulario y no hay una copia en el ' +
          'teléfono. Busca señal y vuelve a entrar.' +
          (r.error ? `\n\nEl servidor dice: ${r.error}` : ''))
      }
      setCargando(false)
    })()
    return () => { vivo = false }
  }, [formularioId, clienteId, itinerarioId])

  const preguntas = datos?.preguntas ?? []
  const skus = datos?.skus ?? []
  const idsSku = useMemo(() => skus.map(s => s.id), [skus])
  const faltan = faltantes(preguntas, respuestas, idsSku)

  function responder(p: Pregunta, valor: Valor) {
    setRespuestas(r => ({ ...r, [p.id]: valor }))
    apuntarRespuestas(itinerarioId, { [p.id]: { tipo: p.tipo, valor } })
      .then(() => { sincronizar().catch(() => {}) })
      .catch(() => {})
  }

  // Agrupadas por bloque, conservando el orden de captura.
  const bloques = useMemo(() => {
    const out: { nombre: string; preguntas: Pregunta[] }[] = []
    preguntas.forEach(p => {
      const nombre = String((p.config as any)?.bloque ?? 'Preguntas')
      const ultimo = out[out.length - 1]
      if (ultimo && ultimo.nombre === nombre) ultimo.preguntas.push(p)
      else out.push({ nombre, preguntas: [p] })
    })
    return out
  }, [preguntas])

  if (cargando) {
    return (
      <SafeAreaView style={[s.pantalla, s.centrado]}>
        <ActivityIndicator color={c.azul} size="large" />
        <Text style={s.cargandoTexto}>Abriendo el formulario…</Text>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={s.pantalla} edges={['top', 'bottom', 'left', 'right']}>
      <View style={s.barra}>
        <Pressable onPress={onCerrar} style={s.volver}
                   accessibilityRole="button" accessibilityLabel="Volver a la visita">
          <Text style={s.volverTexto}>‹  Visita</Text>
        </Pressable>
        <Text style={[s.contador, faltan.length === 0 && s.contadorListo]}>
          {faltan.length === 0
            ? 'Completo'
            : `Faltan ${faltan.length} obligatoria${faltan.length === 1 ? '' : 's'}`}
        </Text>
      </View>

      <ScrollView contentContainerStyle={s.cuerpo} keyboardShouldPersistTaps="handled">
        {error !== '' && (
          <View style={s.aviso}><Text style={s.avisoTexto}>{error}</Text></View>
        )}

        {bloques.map(b => {
          const visibles = b.preguntas.filter(p => seMuestra(p, respuestas))
          if (visibles.length === 0) return null
          return (
            <View key={b.nombre + b.preguntas[0].id} style={s.bloque}>
              <Text style={s.bloqueTitulo}>{b.nombre.toUpperCase()}</Text>
              {visibles.map(p => (
                <Campo key={p.id} pregunta={p} valor={respuestas[p.id]} skus={skus}
                       falta={faltan.some(x => x.id === p.id)}
                       onCambio={v => responder(p, v)} />
              ))}
            </View>
          )
        })}

        <Text style={s.nota}>
          Lo que capturas se guarda en el teléfono conforme lo escribes, aunque
          no haya señal. Sale solo cuando la haya.
        </Text>
      </ScrollView>
    </SafeAreaView>
  )
}

// ---------------------------------------------------------------------

function Campo({ pregunta, valor, skus, falta, onCambio }: {
  pregunta: Pregunta; valor: Valor | undefined; skus: Sku[]
  falta: boolean; onCambio: (v: Valor) => void
}) {
  const p = pregunta
  return (
    <View style={[s.campo, falta && s.campoFalta]}>
      <Text style={s.pregunta}>
        {p.texto}
        {p.obligatoria && <Text style={s.obligatoria}> *</Text>}
      </Text>

      {!soportada(p.tipo) ? (
        <Text style={s.sinSoporte}>
          {p.tipo === 'foto' ? 'Las fotografías se capturan en la siguiente versión.'
            : p.tipo === 'firma' ? 'La firma se captura en la siguiente versión.'
            : 'El lector de código de barras se agrega en la siguiente versión.'}
        </Text>
      ) : p.tipo === 'booleano' ? (
        <View style={s.dosBotones}>
          <Opcion texto="SÍ" activo={valor === true} onPress={() => onCambio(true)} />
          <Opcion texto="NO" activo={valor === false} onPress={() => onCambio(false)} />
        </View>
      ) : p.tipo === 'opcion_unica' ? (
        <View style={s.lista}>
          {p.opcion_pregunta.map(o => (
            <Opcion key={o.id} texto={o.texto} ancho activo={valor === o.id}
                    onPress={() => onCambio(o.id)} />
          ))}
        </View>
      ) : p.tipo === 'opcion_multiple' ? (
        <View style={s.lista}>
          {p.opcion_pregunta.map(o => {
            const puestas = Array.isArray(valor) ? valor : []
            const on = puestas.includes(o.id)
            return (
              <Opcion key={o.id} texto={o.texto} ancho activo={on}
                      onPress={() => onCambio(on ? puestas.filter(x => x !== o.id)
                                                 : [...puestas, o.id])} />
            )
          })}
        </View>
      ) : p.tipo === 'existencia_sku' || p.tipo === 'precio_sku' ? (
        <PorSku pregunta={p} valor={valor} skus={skus} onCambio={onCambio} />
      ) : (
        <TextInput
          style={[s.entrada, p.tipo === 'texto' && s.entradaLarga]}
          value={valor == null ? '' : String(valor)}
          onChangeText={t => onCambio(p.tipo === 'numero' ? (t === '' ? null : t) : t)}
          keyboardType={p.tipo === 'numero' ? 'numeric' : 'default'}
          multiline={p.tipo === 'texto'}
          placeholder={p.tipo === 'fecha' ? 'aaaa-mm-dd' : ''}
          placeholderTextColor={c.tinta2}
          accessibilityLabel={p.texto}
        />
      )}
    </View>
  )
}

/** Las preguntas que se contestan SKU por SKU, en una sola pantalla. */
function PorSku({ pregunta, valor, skus, onCambio }: {
  pregunta: Pregunta; valor: Valor | undefined; skus: Sku[]
  onCambio: (v: Valor) => void
}) {
  const mapa = (valor ?? {}) as Record<string, number | boolean>
  const poner = (id: string, v: number | boolean | null) => {
    const copia = { ...mapa }
    if (v === null) delete copia[id]
    else copia[id] = v
    onCambio(copia)
  }

  if (skus.length === 0) {
    return <Text style={s.sinSoporte}>Este cliente todavía no tiene SKUs en el catálogo.</Text>
  }

  return (
    <View style={s.skus}>
      {skus.map(k => (
        <View key={k.id} style={s.sku}>
          <View style={s.skuNombre}>
            <Text style={s.skuCodigo}>{k.codigo}</Text>
            <Text style={s.skuTexto} numberOfLines={2}>{k.nombre}</Text>
          </View>

          {pregunta.tipo === 'existencia_sku' ? (
            <View style={s.dosChicos}>
              <Opcion chico texto="HAY" activo={mapa[k.id] === true}
                      onPress={() => poner(k.id, true)} />
              <Opcion chico texto="NO HAY" activo={mapa[k.id] === false}
                      onPress={() => poner(k.id, false)} />
            </View>
          ) : (
            <TextInput
              style={s.precio}
              value={mapa[k.id] == null ? '' : String(mapa[k.id])}
              onChangeText={t => poner(k.id, t === '' ? null : Number(t))}
              keyboardType="decimal-pad"
              placeholder={k.precio_sugerido != null ? String(k.precio_sugerido) : '0.00'}
              placeholderTextColor={c.neutro}
              accessibilityLabel={`Precio de ${k.nombre}`}
            />
          )}
        </View>
      ))}
    </View>
  )
}

function Opcion({ texto, activo, onPress, ancho, chico }: {
  texto: string; activo: boolean; onPress: () => void; ancho?: boolean; chico?: boolean
}) {
  return (
    <Pressable
      style={({ pressed }) => [
        s.opcion, ancho && s.opcionAncha, chico && s.opcionChica,
        activo && s.opcionOn, pressed && { opacity: 0.85 },
      ]}
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected: activo }}
      accessibilityLabel={texto}>
      <Text style={[s.opcionTexto, chico && s.opcionTextoChico, activo && s.opcionTextoOn]}>
        {texto}
      </Text>
    </Pressable>
  )
}

const s = StyleSheet.create({
  pantalla: { flex: 1, backgroundColor: c.arena },
  centrado: { alignItems: 'center', justifyContent: 'center', gap: 12 },
  cargandoTexto: { fontFamily: f.texto, fontSize: 14, color: c.tinta2 },

  barra: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 8, paddingVertical: 4, backgroundColor: c.blanco,
    borderBottomWidth: 1, borderBottomColor: c.borde },
  volver: { minHeight: TOCABLE, justifyContent: 'center', paddingHorizontal: 12 },
  volverTexto: { fontFamily: f.textoMedio, fontSize: 16, color: c.azul },
  contador: { fontFamily: f.textoFuerte, fontSize: 13, color: c.naranjaTexto,
    paddingHorizontal: 14 },
  contadorListo: { color: c.exitoTexto },

  cuerpo: { padding: 16, paddingBottom: 40, gap: 16 },

  bloque: { gap: 10 },
  bloqueTitulo: { fontFamily: f.displaySemi, fontSize: 12, color: c.tinta2,
    letterSpacing: 1.1, marginTop: 4 },

  campo: { backgroundColor: c.blanco, borderRadius: 11, padding: 14,
    borderWidth: 1, borderColor: c.borde, gap: 10 },
  // Lo que falta se marca en el canto, no con texto: se encuentra de
  // un vistazo al bajar por la lista.
  campoFalta: { borderLeftWidth: 4, borderLeftColor: c.naranja },
  pregunta: { fontFamily: f.textoMedio, fontSize: 15.5, color: c.tinta, lineHeight: 21 },
  obligatoria: { color: c.naranjaTexto, fontFamily: f.textoFuerte },
  sinSoporte: { fontFamily: f.texto, fontSize: 13, color: c.neutroTexto,
    backgroundColor: c.neutroSuave, borderRadius: 8, padding: 10, lineHeight: 18 },

  entrada: { fontFamily: f.texto, borderWidth: 1, borderColor: c.borde, borderRadius: 9,
    paddingHorizontal: 12, minHeight: TOCABLE, fontSize: 16, color: c.tinta,
    backgroundColor: c.arena },
  entradaLarga: { minHeight: 84, paddingTop: 12, textAlignVertical: 'top' },

  dosBotones: { flexDirection: 'row', gap: 10 },
  dosChicos: { flexDirection: 'row', gap: 6 },
  lista: { gap: 8 },

  opcion: { flex: 1, minHeight: TOCABLE, borderRadius: 9, borderWidth: 1.5,
    borderColor: c.borde, backgroundColor: c.blanco,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  opcionAncha: { flex: 0, alignItems: 'flex-start' },
  opcionChica: { flex: 0, minHeight: 40, paddingHorizontal: 10 },
  opcionOn: { backgroundColor: c.azulSuave, borderColor: c.azul },
  opcionTexto: { fontFamily: f.textoMedio, fontSize: 15, color: c.tinta },
  opcionTextoChico: { fontSize: 12.5 },
  opcionTextoOn: { fontFamily: f.textoFuerte, color: c.azul },

  skus: { gap: 8 },
  sku: { flexDirection: 'row', alignItems: 'center', gap: 10,
    borderTopWidth: 1, borderTopColor: '#EFEDE9', paddingTop: 8 },
  skuNombre: { flex: 1, minWidth: 0 },
  skuCodigo: { fontFamily: f.displaySemi, fontSize: 11.5, color: c.tinta2,
    letterSpacing: 0.5, ...CIFRAS },
  skuTexto: { fontFamily: f.texto, fontSize: 14, color: c.tinta, lineHeight: 19 },
  precio: { fontFamily: f.textoMedio, borderWidth: 1, borderColor: c.borde,
    borderRadius: 8, paddingHorizontal: 10, minHeight: 44, width: 104,
    fontSize: 16, color: c.tinta, backgroundColor: c.arena, textAlign: 'right',
    ...CIFRAS },

  nota: { fontFamily: f.texto, fontSize: 12.5, color: c.tinta2, lineHeight: 18,
    textAlign: 'center', marginTop: 4 },

  aviso: { backgroundColor: c.errorSuave, borderWidth: 1, borderColor: c.errorBorde,
    borderRadius: 9, padding: 12 },
  avisoTexto: { fontFamily: f.texto, color: c.errorTexto, fontSize: 14, lineHeight: 20 },
})
