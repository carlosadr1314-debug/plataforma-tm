import { memo } from 'react'
import { View, Text, Pressable, StyleSheet } from 'react-native'
import { c, f } from './tema'

// =====================================================================
// Teclado numerico
//
// El promotor teclea de pie, con una mano y con prisa. El teclado del
// sistema se come media pantalla y cambia de tamano entre telefonos; este
// esta siempre en el mismo lugar, con teclas grandes, y no deja escribir
// nada que no sea un digito.
//
// No tiene estado: recibe que hacer con cada tecla y ya.
// =====================================================================

type Props = {
  onDigito: (d: string) => void
  onBorrar: () => void
  onLimpiar: () => void
  deshabilitado?: boolean
}

const FILAS = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
]

function Teclado({ onDigito, onBorrar, onLimpiar, deshabilitado }: Props) {
  return (
    <View style={s.teclado}>
      {FILAS.map(fila => (
        <View key={fila[0]} style={s.fila}>
          {fila.map(d => (
            <Tecla key={d} etiqueta={d} onPress={() => onDigito(d)}
                   deshabilitado={deshabilitado} />
          ))}
        </View>
      ))}

      <View style={s.fila}>
        <Tecla etiqueta="LIMPIAR" chica onPress={onLimpiar}
               deshabilitado={deshabilitado} />
        <Tecla etiqueta="0" onPress={() => onDigito('0')}
               deshabilitado={deshabilitado} />
        <Tecla etiqueta="BORRAR" chica onPress={onBorrar}
               deshabilitado={deshabilitado} />
      </View>
    </View>
  )
}

function Tecla({ etiqueta, onPress, chica, deshabilitado }: {
  etiqueta: string; onPress: () => void; chica?: boolean; deshabilitado?: boolean
}) {
  return (
    <Pressable
      style={({ pressed }) => [
        s.tecla,
        chica && s.teclaSec,
        pressed && !deshabilitado && s.teclaPresionada,
        deshabilitado && s.teclaApagada,
      ]}
      onPress={onPress}
      disabled={deshabilitado}
      accessibilityRole="button"
      accessibilityLabel={
        etiqueta === 'BORRAR' ? 'Borrar el último dígito'
        : etiqueta === 'LIMPIAR' ? 'Borrar todo'
        : etiqueta
      }>
      <Text style={[s.teclaTexto, chica && s.teclaTextoSec]}>{etiqueta}</Text>
    </Pressable>
  )
}

export default memo(Teclado)

const s = StyleSheet.create({
  teclado: { gap: 8 },
  fila: { flexDirection: 'row', gap: 8 },

  // 60 de alto con 8 de separacion: muy por encima del minimo de 48.
  tecla: {
    flex: 1, minHeight: 60, borderRadius: 11,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: c.blanco, borderWidth: 1, borderColor: c.borde,
  },
  teclaSec: { backgroundColor: c.arena },
  teclaPresionada: { backgroundColor: c.azulSuave, borderColor: c.azulClaro },
  teclaApagada: { opacity: 0.4 },

  teclaTexto: { fontFamily: f.display, fontSize: 25, color: c.tinta },
  // 12.5 en semibold con espaciado: se lee sin competir con los digitos.
  teclaTextoSec: { fontFamily: f.displaySemi, fontSize: 12.5,
    color: c.tinta2, letterSpacing: 0.6 },
})
