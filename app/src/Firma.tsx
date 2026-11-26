import { useRef, useState } from 'react'
import { View, Text, Pressable, StyleSheet, PanResponder, type LayoutChangeEvent } from 'react-native'
import Svg, { Path } from 'react-native-svg'
import { c, f, TOCABLE } from './tema'

// =====================================================================
// Firma
//
// Se guarda como TRAZOS, no como imagen. Una firma son lineas, y
// guardarla como foto costaria unos 100 KB, una subida mas y una
// ruta en el bucket; como texto son dos o tres kilobytes que viajan
// con las respuestas que ya se mandan. Ademas se dibuja nitida a
// cualquier tamano, que una imagen de 320 px no hace.
//
// El formato lleva el tamano del recuadro en el que se firmo, porque
// sin el no se puede reconstruir la proporcion en la oficina.
// =====================================================================

export type FirmaGuardada = {
  w: number
  h: number
  /** Un elemento por trazo, en formato de ruta SVG. */
  t: string[]
}

/** Lo que se guarda en la respuesta: texto, para que viaje como las demas. */
export function serializar(f2: FirmaGuardada) { return JSON.stringify(f2) }

export function leerFirma(valor: unknown): FirmaGuardada | null {
  if (typeof valor !== 'string' || valor === '') return null
  try {
    const o = JSON.parse(valor) as FirmaGuardada
    return Array.isArray(o?.t) && o.t.length > 0 ? o : null
  } catch { return null }
}

export default function Firma({ valor, onCambio }: {
  valor: unknown
  onCambio: (v: string | null) => void
}) {
  const guardada = leerFirma(valor)
  const [trazos, setTrazos] = useState<string[]>(guardada?.t ?? [])
  const [enCurso, setEnCurso] = useState('')
  const caja = useRef({ w: guardada?.w ?? 0, h: guardada?.h ?? 0 })
  const actual = useRef('')

  // El PanResponder se arma una sola vez: si se recreara en cada
  // repintado, soltaria el trazo a media firma.
  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      // El dedo que firma no debe arrastrar la pantalla de atras.
      onPanResponderTerminationRequest: () => false,

      onPanResponderGrant: e => {
        const { locationX, locationY } = e.nativeEvent
        actual.current = `M${locationX.toFixed(1)},${locationY.toFixed(1)}`
        setEnCurso(actual.current)
      },
      onPanResponderMove: e => {
        const { locationX, locationY } = e.nativeEvent
        actual.current += ` L${locationX.toFixed(1)},${locationY.toFixed(1)}`
        setEnCurso(actual.current)
      },
      onPanResponderRelease: () => {
        const t = actual.current
        actual.current = ''
        setEnCurso('')
        if (!t) return
        setTrazos(previos => {
          const todos = [...previos, t]
          onCambio(serializar({ w: caja.current.w, h: caja.current.h, t: todos }))
          return todos
        })
      },
    }),
  ).current

  function medir(e: LayoutChangeEvent) {
    const { width, height } = e.nativeEvent.layout
    caja.current = { w: Math.round(width), h: Math.round(height) }
  }

  function borrar() {
    setTrazos([])
    setEnCurso('')
    actual.current = ''
    onCambio(null)
  }

  const vacia = trazos.length === 0 && enCurso === ''

  return (
    <View>
      <View style={s.lienzo} onLayout={medir} {...responder.panHandlers}
            accessibilityLabel="Recuadro para firmar">
        <Svg width="100%" height="100%">
          {trazos.map((d, i) => (
            <Path key={i} d={d} stroke={c.tinta} strokeWidth={2.5}
                  strokeLinecap="round" strokeLinejoin="round" fill="none" />
          ))}
          {enCurso !== '' && (
            <Path d={enCurso} stroke={c.tinta} strokeWidth={2.5}
                  strokeLinecap="round" strokeLinejoin="round" fill="none" />
          )}
        </Svg>

        {vacia && (
          <View style={s.marca} pointerEvents="none">
            <Text style={s.marcaTexto}>Firma aquí con el dedo</Text>
          </View>
        )}
      </View>

      <View style={s.pie}>
        <Text style={s.nota}>
          {vacia ? 'Todavía sin firmar.' : 'Si quedó mal, bórrala y vuelve a firmar.'}
        </Text>
        <Pressable onPress={borrar} disabled={vacia}
                   style={({ pressed }) => [s.borrar, pressed && { opacity: 0.85 },
                                            vacia && { opacity: 0.4 }]}
                   accessibilityRole="button" accessibilityLabel="Borrar la firma">
          <Text style={s.borrarTexto}>BORRAR</Text>
        </Pressable>
      </View>
    </View>
  )
}

const s = StyleSheet.create({
  lienzo: {
    height: 170, borderRadius: 10, backgroundColor: c.blanco,
    borderWidth: 1.5, borderColor: c.borde, overflow: 'hidden',
  },
  marca: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center' },
  marcaTexto: { fontFamily: f.texto, fontSize: 13.5, color: c.tinta2 },
  pie: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    gap: 10, marginTop: 8 },
  nota: { fontFamily: f.texto, fontSize: 12, color: c.tinta2, flex: 1 },
  borrar: {
    minHeight: TOCABLE, paddingHorizontal: 18, borderRadius: 9,
    borderWidth: 1.5, borderColor: c.azul, alignItems: 'center', justifyContent: 'center',
  },
  borrarTexto: { fontFamily: f.display, fontSize: 14, color: c.azul, letterSpacing: 0.5 },
})
