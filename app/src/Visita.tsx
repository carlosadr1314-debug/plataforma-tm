import { useEffect, useState } from 'react'
import {
  View, Text, Pressable, StyleSheet, ScrollView, TextInput,
  ActivityIndicator, Modal,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import * as Location from 'expo-location'
import { apuntar, sincronizar, formularioGuardado, respuestasGuardadas } from './sinSenal'
import { pendientes as faltantes } from './reglasFormulario'
import { fotosDe, olvidarFotosDe } from './fotos'
import Formulario from './Formulario'
import { zonaDeCheckin, TOLERANCIA_M } from './radio'
import { c, f, CIFRAS, TOCABLE } from './tema'

// =====================================================================
// La visita
//
// Lo que el promotor abre al llegar a una tienda. Tres momentos:
// registrar la llegada, levantar el formulario y cerrar.
//
// El radio tiene tres zonas, no dos:
//
//   dentro del radio       se registra y ya
//   hasta 20 m mas alla    se avisa con la cifra y se deja registrar
//   mas lejos que eso      no se deja; solo queda marcarla no realizada
//
// Veinte metros suenan a poquisimo y lo serian si se comparara la
// distancia pelona. No se compara esa: se compara la distancia MENOS
// el margen de error que reporta el propio telefono. La pregunta es
// "¿aun en el mejor de los casos sigue lejos?". Si el GPS dice 300 m
// con margen de 250, el mejor caso son 50 y se le da el beneficio de
// la duda; si dice 900 con margen de 15, no hay duda que dar. Esa
// resta es la que absorbe el GPS malo de adentro de una tienda, y por
// eso la tolerancia de encima puede ser chica.
//
// La perilla de verdad es el radio de cada tienda, que ya se captura
// una por una. Si en una tienda los promotores se topan seguido con
// el bloqueo, lo que esta mal es su radio, no esta tolerancia.
//
// Y esto es un seguro contra errores honestos, no contra fraude: las
// coordenadas las manda el telefono. Al tramposo lo delata el rastro
// continuo de la jornada, que enseña si se acerco o no a la tienda.
// =====================================================================

export type Parada = {
  id: string
  hora_estimada: string | null
  pdv: {
    codigo: string; nombre: string; direccion: string | null; ciudad: string | null
    lat: number | null; lng: number | null; radio_checkin: number
  } | null
  cliente_id?: string | null
  tarea: { nombre: string; formulario_id?: string | null } | null
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
  const [medicion, setMedicion] = useState<{ metros: number; margen: number } | null>(null)
  const [midiendo, setMidiendo] = useState(false)
  const [confirmar, setConfirmar] = useState<null | { metros: number; pos: Location.LocationObject }>(null)
  const [noRealizada, setNoRealizada] = useState(false)
  const [enFormulario, setEnFormulario] = useState(false)
  const [faltan, setFaltan] = useState<number | null>(null)
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
        setMedicion({
          metros: metrosEntre(pos.coords.latitude, pos.coords.longitude,
                              pdv.lat as number, pdv.lng as number),
          margen: Math.round(pos.coords.accuracy ?? 0),
        })
      } catch { /* sin señal de GPS todavia */ }
      finally { if (vivo) setMidiendo(false) }
    })()
    return () => { vivo = false }
  }, [estado, pdv?.lat, pdv?.lng])

  const formularioId = parada.tarea?.formulario_id ?? null

  // Cuantas obligatorias faltan. Se recalcula al volver del
  // formulario, que es cuando pudo haber cambiado.
  useEffect(() => {
    if (!formularioId || enFormulario) return
    let vivo = true
    ;(async () => {
      const datos = await formularioGuardado(formularioId)
      const previas = await respuestasGuardadas(parada.id)
      // Las fotos se cuentan aparte: no viven en respuestas. Sin esto
      // la pantalla decia "faltan 8" mientras el formulario decia
      // "completo", y la visita no se dejaba cerrar.
      const fotos = await fotosDe(parada.id)
      if (!vivo || !datos) { if (vivo) setFaltan(null); return }
      const r: Record<string, any> = {}
      Object.entries(previas).forEach(([k, v]) => { r[k] = v.valor })
      const porPregunta: Record<string, number> = {}
      fotos.forEach(f => { if (f.pregunta_id) porPregunta[f.pregunta_id] = (porPregunta[f.pregunta_id] ?? 0) + 1 })
      setFaltan(faltantes(datos.preguntas, r, datos.skus.map(k => k.id), porPregunta).length)
    })()
    return () => { vivo = false }
  }, [formularioId, enFormulario, parada.id])

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
      const margen = Math.round(pos.coords.accuracy ?? 0)
      setMedicion({ metros: m, margen })

      const zona = zonaDeCheckin(m, margen, pdv.radio_checkin ?? 0)
      if (zona === 'bloqueado') {
        // El intento deja huella. Sin esto, "fue y el GPS no lo dejo"
        // se ve en la oficina igual que "nunca fue", y son cosas muy
        // distintas: una es un radio mal capturado, la otra es un
        // promotor que no trabajo. Se guardan la distancia y las
        // coordenadas, pero NO la hora de llegada: no llego.
        await apuntar(parada.id, {
          distancia_pdv: m,
          check_in_lat: pos.coords.latitude,
          check_in_lng: pos.coords.longitude,
          check_in_precision: pos.coords.accuracy ?? null,
          ubicacion_simulada: pos.mocked === true,
        })
        sincronizar().catch(() => {})
        return                                      // la pantalla lo explica
      }
      if (zona === 'cerca') { setConfirmar({ metros: m, pos }); return }
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
    // Las fotos ya entregadas sueltan su espacio. Las que todavia no
    // salen se quedan: la visita esta cerrada aqui, pero la evidencia
    // sigue debiendose.
    olvidarFotosDe(parada.id).catch(() => {})
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

  // Las tres zonas, calculadas en un solo lugar.
  const radio = pdv?.radio_checkin ?? 0
  const limite = radio + TOLERANCIA_M
  const zona = medicion ? zonaDeCheckin(medicion.metros, medicion.margen, radio) : null
  const dentro = zona === 'dentro'
  const cerca = zona === 'cerca'
  const bloqueado = zona === 'bloqueado'

  if (enFormulario && formularioId && parada.cliente_id) {
    return (
      <Formulario
        itinerarioId={parada.id}
        formularioId={formularioId}
        clienteId={parada.cliente_id}
        onCerrar={() => setEnFormulario(false)}
      />
    )
  }

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
            <View style={[s.medida,
                          dentro && s.medidaOk,
                          cerca && s.medidaLejos,
                          bloqueado && s.medidaMala]}>
              {midiendo ? (
                <>
                  <ActivityIndicator color={c.azul} />
                  <Text style={s.medidaTexto}>Midiendo qué tan lejos estás…</Text>
                </>
              ) : medicion == null ? (
                <Text style={s.medidaTexto}>
                  {pdv?.lat
                    ? 'Todavía sin señal de GPS. Puedes registrar la llegada de todos modos.'
                    : 'Esta tienda no tiene coordenadas, así que no se puede medir la distancia.'}
                </Text>
              ) : (
                <>
                  <Text style={[s.metros,
                                dentro && s.metrosOk,
                                cerca && s.metrosLejos,
                                bloqueado && s.metrosMal]}>
                    {medicion.metros} m
                  </Text>
                  <Text style={s.medidaTexto}>
                    {dentro
                      ? `Estás dentro del radio de la tienda (${radio} m).`
                      : bloqueado
                        ? `Estás demasiado lejos para registrar. El límite son ${limite} m ` +
                          `desde el centro de la tienda.`
                        : `La tienda está a ${radio} m a la redonda. Estás apenas fuera.`}
                  </Text>
                  {medicion.margen > 0 && (
                    <Text style={s.margenTexto}>
                      El GPS reporta un margen de ±{medicion.margen} m
                      {bloqueado ? ', y aun así te deja fuera.' : '.'}
                    </Text>
                  )}
                </>
              )}
            </View>

            {bloqueado && (
              <View style={s.pendiente}>
                <Text style={s.pendienteTitulo}>Acércate a la tienda</Text>
                <Text style={s.pendienteTexto}>
                  Si ya estás adentro, espera unos segundos y vuelve a medir: bajo
                  techo el GPS tarda en acomodarse. Si de plano no te ubica, marca
                  la visita como no realizada y dilo ahí.{'\n\n'}
                  Tu intento ya quedó anotado con la distancia, así que en la
                  oficina no se va a ver como si no hubieras venido.
                </Text>
              </View>
            )}

            <Boton texto={bloqueado ? 'VOLVER A MEDIR' : 'REGISTRAR LLEGADA'}
                   onPress={intentarLlegada} ocupado={trabajando} />
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

            {formularioId ? (
              <Pressable
                style={({ pressed }) => [s.form, pressed && { opacity: 0.85 }]}
                onPress={() => setEnFormulario(true)}
                accessibilityRole="button"
                accessibilityLabel="Abrir el formulario de la visita">
                <View style={{ flex: 1 }}>
                  <Text style={s.formTitulo}>{parada.tarea?.nombre ?? 'Formulario'}</Text>
                  <Text style={s.formTexto}>
                    {faltan == null ? 'Tócalo para capturar.'
                      : faltan === 0 ? 'Todas las obligatorias contestadas.'
                      : `Faltan ${faltan} pregunta${faltan === 1 ? '' : 's'} obligatoria${faltan === 1 ? '' : 's'}.`}
                  </Text>
                </View>
                <Text style={s.formFlecha}>›</Text>
              </Pressable>
            ) : (
              <View style={s.pendiente}>
                <Text style={s.pendienteTitulo}>Esta visita no trae formulario</Text>
                <Text style={s.pendienteTexto}>
                  La tarea que le asignaron no tiene uno. Puedes cerrarla igual.
                </Text>
              </View>
            )}

            {faltan != null && faltan > 0 && (
              <Text style={s.candado}>
                Para terminar la visita hay que contestar lo obligatorio.
              </Text>
            )}

            <Boton texto="TERMINAR VISITA" onPress={terminar} ocupado={trabajando}
                   apagado={faltan != null && faltan > 0} />
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

function Boton({ texto, onPress, ocupado, apagado }: {
  texto: string; onPress: () => void; ocupado?: boolean; apagado?: boolean
}) {
  return (
    <Pressable
      style={({ pressed }) => [s.boton, s.botonGrande, apagado && s.botonApagado,
                               pressed && !apagado && { opacity: 0.85 }]}
      onPress={onPress} disabled={ocupado || apagado}
      accessibilityRole="button" accessibilityLabel={texto}
      accessibilityState={{ busy: !!ocupado, disabled: !!apagado }}>
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
  // El margen se enseña siempre: es lo que explica por que una cifra
  // que parece buena no alcanza, o al reves.
  margenTexto: { fontFamily: f.texto, fontSize: 12, color: c.neutroTexto,
    textAlign: 'center' },

  pendiente: { backgroundColor: c.neutroSuave, borderRadius: 10, padding: 14, gap: 4 },
  pendienteTitulo: { fontFamily: f.textoFuerte, fontSize: 14.5, color: c.neutroTexto },
  pendienteTexto: { fontFamily: f.texto, fontSize: 13.5, color: c.neutroTexto,
    lineHeight: 19 },

  boton: { backgroundColor: c.azul, borderRadius: 10, minHeight: 52,
    alignItems: 'center', justifyContent: 'center', flex: 1, paddingHorizontal: 14 },
  botonGrande: { minHeight: 58, marginTop: 6, flex: 0 },
  botonSec: { backgroundColor: c.blanco, borderWidth: 1.5, borderColor: c.azul },
  // Apagado, no escondido: se ve que ahi esta y que falta algo.
  botonApagado: { backgroundColor: c.neutroTexto },

  form: { flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: c.blanco, borderRadius: 11, padding: 14,
    borderWidth: 1.5, borderColor: c.azul },
  formTitulo: { fontFamily: f.textoFuerte, fontSize: 15.5, color: c.azul },
  formTexto: { fontFamily: f.texto, fontSize: 13, color: c.tinta2,
    lineHeight: 18, marginTop: 2 },
  formFlecha: { fontFamily: f.display, fontSize: 26, color: c.azul },
  candado: { fontFamily: f.texto, fontSize: 12.5, color: c.naranjaTexto,
    textAlign: 'center', lineHeight: 18 },
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
