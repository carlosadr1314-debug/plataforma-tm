import { useEffect, useState } from 'react'
import {
  View, Text, Pressable, StyleSheet, ScrollView, TextInput,
  ActivityIndicator, Modal,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import * as Location from 'expo-location'
import { apuntar, sincronizar } from './sinSenal'
import { c, f, CIFRAS, TOCABLE } from './tema'

// =====================================================================
// La visita
//
// Lo que el promotor abre al llegar a una tienda. Tres momentos:
// registrar la llegada, levantar el formulario y cerrar.
//
// Sobre el radio: la llegada NO se bloquea por estar lejos. El GPS
// dentro de una tienda se va facil cincuenta metros, y dejar a alguien
// sin poder trabajar por eso es peor que el problema que resuelve. Lo
// que se hace es medir la distancia, guardarla y decirsela en la cara
// antes de registrar. La consola ya cuenta esas visitas como "fuera de
// radio": el sistema esta hecho para registrar la discrepancia, no
// para impedir el trabajo.
// =====================================================================

export type Parada = {
  id: string
  hora_estimada: string | null
  pdv: {
    codigo: string; nombre: string; direccion: string | null; ciudad: string | null
    lat: number | null; lng: number | null; radio_checkin: number
  } | null
  tarea: { nombre: string } | null
  visita: any
}

const unaVisita = (v: any) => (Array.isArray(v) ? v[0] : v) ?? null

// Haversine. Para distancias de tienda sobra con la tierra como esfera.
function metrosEntre(aLat: number, aLng: number, bLat: number, bLng: number) {
  const R = 6371000
  const rad = (g: number) => (g * Math.PI) / 180
  const dLat = rad(bLat - aLat), dLng = rad(bLng - aLng)
  const h = Math.sin(dLat / 2) ** 2 +
            Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2
  return Math.round(2 * R * Math.asin(Math.sqrt(h)))
}

const hhmm = (iso: string) =>
  new Date(iso).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })

// Minutos entre la hora estimada de la parada y la llegada real.
// Negativo = llego antes. Sirve para el reporte de puntualidad.
function desfase(horaEstimada: string | null, llegada: Date) {
  if (!horaEstimada) return null
  const [h, m] = horaEstimada.split(':').map(Number)
  const prevista = new Date(llegada)
  prevista.setHours(h, m, 0, 0)
  return Math.round((llegada.getTime() - prevista.getTime()) / 60000)
}

export default function Visita({ parada, onCerrar, onCambio }: {
  parada: Parada
  onCerrar: () => void
  /** volver: si al terminar hay que regresar a la ruta o quedarse aqui. */
  onCambio: (volver: boolean) => void
}) {
  const visita = unaVisita(parada.visita)
  const estado: string = visita?.estado ?? 'programada'
  const pdv = parada.pdv

  const [trabajando, setTrabajando] = useState(false)
  const [error, setError] = useState('')
  const [distancia, setDistancia] = useState<number | null>(null)
  const [midiendo, setMidiendo] = useState(false)
  const [confirmar, setConfirmar] = useState<null | { metros: number; pos: Location.LocationObject }>(null)
  const [noRealizada, setNoRealizada] = useState(false)
  const [motivo, setMotivo] = useState('')

  // Al abrir, medir a que distancia esta: es lo primero que uno quiere
  // saber al llegar, y evita descubrir el problema hasta despues de
  // picarle al boton.
  useEffect(() => {
    if (estado !== 'programada' || !pdv?.lat || !pdv?.lng) return
    let vivo = true
    ;(async () => {
      setMidiendo(true)
      try {
        const permiso = await Location.getForegroundPermissionsAsync()
        if (!permiso.granted) return
        const pos = await Location.getCurrentPositionAsync(
          { accuracy: Location.Accuracy.High })
        if (!vivo) return
        setDistancia(metrosEntre(pos.coords.latitude, pos.coords.longitude,
                                 pdv.lat as number, pdv.lng as number))
      } catch { /* sin señal de GPS todavia */ }
      finally { if (vivo) setMidiendo(false) }
    })()
    return () => { vivo = false }
  }, [estado, pdv?.lat, pdv?.lng])

  async function tomarPosicion() {
    const permiso = await Location.requestForegroundPermissionsAsync()
    if (!permiso.granted) {
      setError('Sin permiso de ubicación no se puede registrar la llegada. ' +
        'Actívalo en los ajustes del teléfono.')
      return null
    }
    try {
      return await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High })
    } catch {
      setError('No se pudo leer el GPS. Sal un momento a donde haya cielo abierto ' +
        'e inténtalo otra vez.')
      return null
    }
  }

  async function intentarLlegada() {
    setError('')
    setTrabajando(true)
    const pos = await tomarPosicion()
    setTrabajando(false)
    if (!pos) return

    if (pdv?.lat && pdv?.lng) {
      const m = metrosEntre(pos.coords.latitude, pos.coords.longitude,
                            pdv.lat as number, pdv.lng as number)
      setDistancia(m)
      if (m > (pdv.radio_checkin ?? 0)) { setConfirmar({ metros: m, pos }); return }
      return registrarLlegada(pos, m)
    }
    // Tienda sin coordenadas: no hay contra que medir.
    return registrarLlegada(pos, null)
  }

  async function registrarLlegada(pos: Location.LocationObject, metros: number | null) {
    setConfirmar(null)
    setError('')
    setTrabajando(true)

    const ahora = new Date()
    await guardar({
      estado: 'en_curso',
      check_in: ahora.toISOString(),
      check_in_lat: pos.coords.latitude,
      check_in_lng: pos.coords.longitude,
      check_in_precision: pos.coords.accuracy ?? null,
      ubicacion_simulada: pos.mocked === true,
      distancia_pdv: metros,
      minutos_desfase: desfase(parada.hora_estimada, ahora),
    })
  }

  // Todo se escribe primero en el telefono y se manda despues. Al reves
  // —mandar primero y esperar— el promotor se queda mirando una rueda
  // girar adentro de una tienda sin señal, con el gerente esperandolo.
  async function guardar(campos: Record<string, unknown>, volver = false) {
    setTrabajando(true)
    await apuntar(parada.id, campos)
    sincronizar().catch(() => {})   // sin esperar: si hay red, sale sola
    setTrabajando(false)
    onCambio(volver)
  }

  async function terminar() {
    setError('')
    await guardar({ estado: 'completada', check_out: new Date().toISOString() }, true)
  }

  async function marcarNoRealizada() {
    if (motivo.trim().length < 4) {
      setError('Escribe por qué no se pudo hacer. Lo lee tu supervisor.')
      return
    }
    setError('')
    setNoRealizada(false)
    await guardar({
      estado: 'no_realizada',
      motivo_no_visita: motivo.trim(),
      check_out: new Date().toISOString(),
    }, true)
  }

  const dentro = distancia != null && pdv != null &&
                 distancia <= (pdv.radio_checkin ?? 0)

  return (
    <SafeAreaView style={s.pantalla} edges={['top', 'bottom', 'left', 'right']}>
      <View style={s.barra}>
        <Pressable onPress={onCerrar} style={s.volver}
                   accessibilityRole="button" accessibilityLabel="Volver a la ruta">
          <Text style={s.volverTexto}>‹  Ruta</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={s.cuerpo}>
        <Text style={s.codigo}>{pdv?.codigo}</Text>
        <Text style={s.tienda}>{pdv?.nombre}</Text>
        {!!pdv?.direccion && (
          <Text style={s.direccion}>
            {pdv.direccion}{pdv.ciudad ? ' · ' + pdv.ciudad : ''}
          </Text>
        )}
        {!!parada.tarea?.nombre && <Text style={s.tarea}>{parada.tarea.nombre}</Text>}

        {error !== '' && (
          <View style={s.aviso} accessibilityLiveRegion="polite">
            <Text style={s.avisoTexto}>{error}</Text>
          </View>
        )}

        {estado === 'programada' && (
          <>
            <View style={[s.medida, dentro ? s.medidaOk : distancia != null && s.medidaLejos]}>
              {midiendo ? (
                <>
                  <ActivityIndicator color={c.azul} />
                  <Text style={s.medidaTexto}>Midiendo qué tan lejos estás…</Text>
                </>
              ) : distancia == null ? (
                <Text style={s.medidaTexto}>
                  {pdv?.lat
                    ? 'Todavía sin señal de GPS. Puedes registrar la llegada de todos modos.'
                    : 'Esta tienda no tiene coordenadas, así que no se puede medir la distancia.'}
                </Text>
              ) : (
                <>
                  <Text style={[s.metros, dentro ? s.metrosOk : s.metrosLejos]}>
                    {distancia} m
                  </Text>
                  <Text style={s.medidaTexto}>
                    {dentro
                      ? `Estás dentro del radio de la tienda (${pdv?.radio_checkin} m).`
                      : `La tienda está a ${pdv?.radio_checkin} m a la redonda. Estás fuera.`}
                  </Text>
                </>
              )}
            </View>

            <Boton texto="REGISTRAR LLEGADA" onPress={intentarLlegada} ocupado={trabajando} />
            <Pressable style={s.enlace} onPress={() => { setError(''); setNoRealizada(true) }}
                       accessibilityRole="button">
              <Text style={s.enlaceTexto}>No se pudo hacer esta visita</Text>
            </Pressable>
          </>
        )}

        {estado === 'en_curso' && (
          <>
            <View style={[s.medida, s.medidaOk]}>
              <Text style={[s.metros, s.metrosOk]}>EN CURSO</Text>
              <Text style={s.medidaTexto}>
                Llegada registrada a las {hhmm(visita.check_in)}
                {visita.distancia_pdv != null && ` · a ${Math.round(visita.distancia_pdv)} m de la tienda`}.
              </Text>
            </View>

            <View style={s.pendiente}>
              <Text style={s.pendienteTitulo}>El formulario todavía no está aquí</Text>
              <Text style={s.pendienteTexto}>
                La captura de las preguntas es lo que sigue. Por ahora puedes
                cerrar la visita y la oficina la verá como completada, pero sin
                respuestas.
              </Text>
            </View>

            <Boton texto="TERMINAR VISITA" onPress={terminar} ocupado={trabajando} />
            <Pressable style={s.enlace} onPress={() => { setError(''); setNoRealizada(true) }}
                       accessibilityRole="button">
              <Text style={s.enlaceTexto}>Marcarla como no realizada</Text>
            </Pressable>
          </>
        )}

        {(estado === 'completada' || estado === 'no_realizada') && (
          <View style={[s.medida, estado === 'completada' ? s.medidaOk : s.medidaMala]}>
            <Text style={[s.metros, estado === 'completada' ? s.metrosOk : s.metrosMal]}>
              {estado === 'completada' ? 'COMPLETADA' : 'NO REALIZADA'}
            </Text>
            <Text style={s.medidaTexto}>
              {visita?.check_in && `Llegada ${hhmm(visita.check_in)}. `}
              {visita?.check_out && `Cierre ${hhmm(visita.check_out)}.`}
              {visita?.motivo_no_visita && `\n«${visita.motivo_no_visita}»`}
            </Text>
          </View>
        )}
      </ScrollView>

      {/* Lejos de la tienda: se avisa, no se bloquea. */}
      <Modal visible={!!confirmar} transparent animationType="fade"
             onRequestClose={() => setConfirmar(null)}>
        <View style={s.velo}>
          <View style={s.dialogo}>
            <Text style={s.dialogoTitulo}>Estás lejos de la tienda</Text>
            <Text style={s.dialogoTexto}>
              El GPS te pone a <Text style={s.fuerte}>{confirmar?.metros} m</Text> de
              {' '}{pdv?.nombre}, y el radio de la tienda es de {pdv?.radio_checkin} m.
              {'\n\n'}
              Puedes registrar la llegada igual: queda anotada la distancia y tu
              supervisor la verá marcada como fuera de radio. Si acabas de entrar,
              espera unos segundos a que el GPS se acomode.
            </Text>
            <View style={s.dialogoBotones}>
              <Pressable style={[s.boton, s.botonSec]} onPress={() => setConfirmar(null)}
                         accessibilityRole="button">
                <Text style={[s.botonTexto, s.botonTextoSec]}>ESPERAR</Text>
              </Pressable>
              <Pressable style={s.boton}
                         onPress={() => confirmar && registrarLlegada(confirmar.pos, confirmar.metros)}
                         accessibilityRole="button">
                <Text style={s.botonTexto}>REGISTRAR</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={noRealizada} transparent animationType="fade"
             onRequestClose={() => setNoRealizada(false)}>
        <View style={s.velo}>
          <View style={s.dialogo}>
            <Text style={s.dialogoTitulo}>¿Por qué no se pudo?</Text>
            <Text style={s.dialogoTexto}>
              Lo lee tu supervisor. Entre más claro, menos te van a preguntar.
            </Text>
            <TextInput
              style={s.campo}
              value={motivo}
              onChangeText={setMotivo}
              multiline
              placeholder="La tienda estaba cerrada por inventario"
              placeholderTextColor={c.tinta2}
              accessibilityLabel="Motivo"
            />
            {error !== '' && <Text style={s.avisoTexto}>{error}</Text>}
            <View style={s.dialogoBotones}>
              <Pressable style={[s.boton, s.botonSec]} onPress={() => setNoRealizada(false)}
                         accessibilityRole="button">
                <Text style={[s.botonTexto, s.botonTextoSec]}>CANCELAR</Text>
              </Pressable>
              <Pressable style={s.boton} onPress={marcarNoRealizada}
                         accessibilityRole="button">
                <Text style={s.botonTexto}>GUARDAR</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  )
}

function Boton({ texto, onPress, ocupado }: {
  texto: string; onPress: () => void; ocupado?: boolean
}) {
  return (
    <Pressable
      style={({ pressed }) => [s.boton, s.botonGrande, pressed && { opacity: 0.85 }]}
      onPress={onPress} disabled={ocupado}
      accessibilityRole="button" accessibilityLabel={texto}
      accessibilityState={{ busy: !!ocupado }}>
      {ocupado ? <ActivityIndicator color={c.blanco} />
               : <Text style={s.botonTexto}>{texto}</Text>}
    </Pressable>
  )
}

const s = StyleSheet.create({
  pantalla: { flex: 1, backgroundColor: c.arena },
  barra: { paddingHorizontal: 8, paddingVertical: 4 },
  volver: { minHeight: TOCABLE, justifyContent: 'center', paddingHorizontal: 12 },
  volverTexto: { fontFamily: f.textoMedio, fontSize: 16, color: c.azul },

  cuerpo: { padding: 20, paddingTop: 4, gap: 10 },
  codigo: { fontFamily: f.displaySemi, fontSize: 13, color: c.tinta2,
    letterSpacing: 1, ...CIFRAS },
  tienda: { fontFamily: f.display, fontSize: 26, color: c.tinta, lineHeight: 30 },
  direccion: { fontFamily: f.texto, fontSize: 14, color: c.tinta2, lineHeight: 20 },
  tarea: { fontFamily: f.textoMedio, fontSize: 14, color: c.naranjaTexto, marginTop: 2 },

  medida: { backgroundColor: c.blanco, borderRadius: 12, padding: 16, marginTop: 8,
    borderWidth: 1, borderColor: c.borde, alignItems: 'center', gap: 6 },
  medidaOk: { borderColor: c.exito, borderWidth: 2 },
  medidaLejos: { borderColor: c.naranja, borderWidth: 2 },
  medidaMala: { borderColor: c.error, borderWidth: 2 },
  metros: { fontFamily: f.display, fontSize: 34, color: c.tinta, ...CIFRAS },
  metrosOk: { color: c.exitoTexto },
  metrosLejos: { color: c.naranjaTexto },
  metrosMal: { color: c.errorTexto },
  medidaTexto: { fontFamily: f.texto, fontSize: 14, color: c.tinta2,
    textAlign: 'center', lineHeight: 20 },

  pendiente: { backgroundColor: c.neutroSuave, borderRadius: 10, padding: 14, gap: 4 },
  pendienteTitulo: { fontFamily: f.textoFuerte, fontSize: 14.5, color: c.neutroTexto },
  pendienteTexto: { fontFamily: f.texto, fontSize: 13.5, color: c.neutroTexto,
    lineHeight: 19 },

  boton: { backgroundColor: c.azul, borderRadius: 10, minHeight: 52,
    alignItems: 'center', justifyContent: 'center', flex: 1, paddingHorizontal: 14 },
  botonGrande: { minHeight: 58, marginTop: 6, flex: 0 },
  botonSec: { backgroundColor: c.blanco, borderWidth: 1.5, borderColor: c.azul },
  botonTexto: { fontFamily: f.display, color: c.blanco, fontSize: 15.5, letterSpacing: .9 },
  botonTextoSec: { color: c.azul },

  enlace: { minHeight: TOCABLE, alignItems: 'center', justifyContent: 'center' },
  enlaceTexto: { fontFamily: f.textoMedio, fontSize: 14.5, color: c.azul,
    textDecorationLine: 'underline' },

  velo: { flex: 1, backgroundColor: 'rgba(28,26,23,.5)', justifyContent: 'center',
    padding: 24 },
  dialogo: { backgroundColor: c.blanco, borderRadius: 14, padding: 20, gap: 10 },
  dialogoTitulo: { fontFamily: f.display, fontSize: 20, color: c.tinta },
  dialogoTexto: { fontFamily: f.texto, fontSize: 14, color: c.tinta2, lineHeight: 20 },
  fuerte: { fontFamily: f.textoFuerte, color: c.tinta },
  dialogoBotones: { flexDirection: 'row', gap: 10, marginTop: 6 },

  campo: { fontFamily: f.texto, borderWidth: 1, borderColor: c.borde, borderRadius: 9,
    padding: 12, minHeight: 90, fontSize: 15.5, color: c.tinta,
    backgroundColor: c.arena, textAlignVertical: 'top' },

  aviso: { backgroundColor: c.errorSuave, borderWidth: 1, borderColor: c.errorBorde,
    borderRadius: 9, padding: 12, marginTop: 6 },
  avisoTexto: { fontFamily: f.texto, color: c.errorTexto, fontSize: 14, lineHeight: 20 },
})
