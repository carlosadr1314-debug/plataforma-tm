import { useRef, useState } from 'react'
import { View, Text, Pressable, StyleSheet, Modal, TextInput } from 'react-native'
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera'
import { c, f, TOCABLE, CIFRAS } from './tema'

// =====================================================================
// Lector de codigo de barras
//
// Usa la camara, que ya viene con el lector adentro: no hace falta un
// paquete aparte.
//
// Dos decisiones que importan en el piso de tienda:
//
//   · Se puede escribir a mano. Un codigo rayado o un empaque
//     maltratado no se leen nunca, y dejar al promotor sin salida
//     frente a un anaquel es peor que un codigo tecleado.
//   · Al leer uno se cierra de inmediato y vibra la pantalla con el
//     resultado. Si siguiera escaneando, el ultimo codigo que pasara
//     por el cuadro ganaria, y no es necesariamente el que apuntaba.
// =====================================================================

/** Los que se usan en punto de venta. Los demas solo dan falsos positivos. */
const TIPOS = ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'code39', 'itf14', 'qr'] as const

export default function LectorCodigo({ valor, onCambio }: {
  valor: unknown
  onCambio: (v: string | null) => void
}) {
  const [permiso, pedirPermiso] = useCameraPermissions()
  const [abierto, setAbierto] = useState(false)
  const [aMano, setAMano] = useState(false)
  const [escrito, setEscrito] = useState('')
  // Una sola lectura por apertura.
  const yaLeyo = useRef(false)

  const actual = typeof valor === 'string' && valor !== '' ? valor : null

  async function abrir() {
    if (!permiso?.granted) {
      const r = await pedirPermiso()
      if (!r.granted) { setAMano(true); return }
    }
    yaLeyo.current = false
    setAbierto(true)
  }

  function leido(r: BarcodeScanningResult) {
    if (yaLeyo.current) return
    yaLeyo.current = true
    setAbierto(false)
    onCambio(r.data)
  }

  return (
    <View>
      {actual ? (
        <View style={s.leido}>
          <Text style={s.leidoRotulo}>CÓDIGO</Text>
          <Text style={s.leidoValor} selectable>{actual}</Text>
        </View>
      ) : null}

      <View style={s.botones}>
        <Pressable onPress={abrir}
                   style={({ pressed }) => [s.boton, pressed && { opacity: 0.85 }]}
                   accessibilityRole="button"
                   accessibilityLabel={actual ? 'Escanear otro código' : 'Escanear el código'}>
          <Text style={s.botonTexto}>{actual ? 'ESCANEAR OTRO' : 'ESCANEAR'}</Text>
        </Pressable>

        <Pressable onPress={() => { setEscrito(actual ?? ''); setAMano(v => !v) }}
                   style={({ pressed }) => [s.boton, s.botonSec, pressed && { opacity: 0.85 }]}
                   accessibilityRole="button" accessibilityLabel="Escribir el código a mano">
          <Text style={[s.botonTexto, s.botonTextoSec]}>A MANO</Text>
        </Pressable>
      </View>

      {aMano && (
        <View style={s.mano}>
          <Text style={s.manoRotulo}>Escríbelo tal como viene impreso</Text>
          <CampoManual valor={escrito} onTexto={setEscrito}
            onGuardar={() => {
              const limpio = escrito.trim()
              onCambio(limpio === '' ? null : limpio)
              setAMano(false)
            }} />
        </View>
      )}

      <Modal visible={abierto} animationType="slide"
             onRequestClose={() => setAbierto(false)}>
        <View style={s.camara}>
          <CameraView style={s.vista} facing="back"
            barcodeScannerSettings={{ barcodeTypes: [...TIPOS] }}
            onBarcodeScanned={leido} />

          <View style={s.mira} pointerEvents="none">
            <View style={s.miraCaja} />
          </View>

          <View style={s.camaraPie}>
            <Text style={s.camaraTexto}>
              Apunta al código de barras del producto. Se cierra solo al leerlo.
            </Text>
            <Pressable onPress={() => setAbierto(false)}
                       style={({ pressed }) => [s.cancelar, pressed && { opacity: 0.85 }]}
                       accessibilityRole="button" accessibilityLabel="Cancelar el escaneo">
              <Text style={s.cancelarTexto}>CANCELAR</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  )
}

// Se saca aparte para que el teclado no se cierre en cada tecla, que
// es lo que pasa cuando el campo se recrea con el padre.
function CampoManual({ valor, onTexto, onGuardar }: {
  valor: string; onTexto: (t: string) => void; onGuardar: () => void
}) {
  return (
    <View style={s.manoFila}>
      <TextInput value={valor} onChangeText={onTexto} style={s.entrada}
        autoCapitalize="characters" autoCorrect={false}
        placeholder="Por ejemplo 7501234567890" placeholderTextColor={c.tinta2}
        accessibilityLabel="Código escrito a mano"
        onSubmitEditing={onGuardar} returnKeyType="done" />
      <Pressable onPress={onGuardar}
                 style={({ pressed }) => [s.boton, pressed && { opacity: 0.85 }]}
                 accessibilityRole="button" accessibilityLabel="Guardar el código">
        <Text style={s.botonTexto}>GUARDAR</Text>
      </Pressable>
    </View>
  )
}

const s = StyleSheet.create({
  leido: {
    backgroundColor: c.arena, borderWidth: 1, borderColor: c.borde,
    borderRadius: 9, padding: 10, marginBottom: 8,
  },
  leidoRotulo: { fontFamily: f.texto, fontSize: 10.5, color: c.tinta2,
    letterSpacing: 0.6, marginBottom: 2 },
  leidoValor: { fontFamily: f.textoFuerte, fontSize: 17, color: c.tinta, ...CIFRAS },

  botones: { flexDirection: 'row', gap: 8 },
  boton: { flex: 1, minHeight: TOCABLE, borderRadius: 9, backgroundColor: c.azul,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  botonSec: { backgroundColor: c.blanco, borderWidth: 1.5, borderColor: c.azul },
  botonTexto: { fontFamily: f.display, fontSize: 14.5, color: c.blanco, letterSpacing: 0.6 },
  botonTextoSec: { color: c.azul },

  mano: { marginTop: 10, gap: 6 },
  manoRotulo: { fontFamily: f.texto, fontSize: 12.5, color: c.tinta2 },
  manoFila: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  entrada: {
    flex: 1, minHeight: TOCABLE, borderWidth: 1.5, borderColor: c.borde,
    borderRadius: 9, paddingHorizontal: 12, fontFamily: f.texto, fontSize: 16,
    color: c.tinta, backgroundColor: c.blanco, ...CIFRAS,
  },

  camara: { flex: 1, backgroundColor: '#000' },
  vista: { flex: 1 },
  mira: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0,
    alignItems: 'center', justifyContent: 'center' },
  miraCaja: { width: '78%', height: 160, borderWidth: 2.5, borderColor: '#FFFFFF',
    borderRadius: 14, opacity: 0.9 },
  camaraPie: { padding: 18, paddingBottom: 34, gap: 12, backgroundColor: '#000' },
  camaraTexto: { fontFamily: f.texto, fontSize: 14, color: '#FFFFFF',
    textAlign: 'center', lineHeight: 20 },
  cancelar: { minHeight: TOCABLE, borderRadius: 9, borderWidth: 1.5,
    borderColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  cancelarTexto: { fontFamily: f.display, fontSize: 15, color: '#FFFFFF', letterSpacing: 0.8 },
})
