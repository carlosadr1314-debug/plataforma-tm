import { useCallback, useEffect, useRef, useState } from 'react'
import { AppState } from 'react-native'
import * as Location from 'expo-location'
import { supabase } from './supabase'
import { avisarSalidaDeRadio, avisarFinDeComida, olvidarAvisoDeComida,
         AVISO_COMIDA_MIN } from './avisos'
import { encolar, vaciar, cuantosPendientes, type Punto } from './cola'
import { revisar, sincronizarAlertas, alSalirse } from './vigilanciaRadio'

// =====================================================================
// Jornada y rastreo
//
// El cliente pidio ver al promotor desde que sale de su casa, no desde
// que llega a la primera tienda. La jornada es ese interruptor: el
// promotor la abre al salir y la cierra al terminar, y mientras este
// abierta el telefono reporta donde esta.
//
// Que la abra el promotor y no la aplicacion sola no es un detalle
// tecnico: es la diferencia entre una herramienta de trabajo y un
// rastreador. Fuera de la jornada no se guarda un solo punto.
//
// Esta version captura en PRIMER PLANO: mientras la aplicacion esta
// abierta. Sirve para probar el circuito completo en Expo Go, sin
// compilar nada. El segundo plano —seguir reportando con el telefono
// en la bolsa— necesita expo-task-manager y una compilacion de EAS,
// y va aparte.
//
// El dia ya no se abre con un boton a secas: se abre con un CHECK-IN
// DE SEGURIDAD, que es lo mismo mas la constancia de donde estaba el
// promotor al hacerlo. Es lo que convierte "dijo que salio" en "salio
// de aqui, a esta hora".
//
// Y la COMIDA vive aqui porque cuelga de la jornada: mientras dura, el
// rastreo no se apaga pero si se espacia. Apagarlo del todo dejaria un
// hueco de una hora en el que nadie sabe nada; seguirlo igual que
// siempre es seguir a alguien en su tiempo libre. Un punto cada quince
// minutos dice que no se fue, sin ir tras el.
// =====================================================================

// Un punto por minuto, o antes si se movio 40 metros. Mas seguido
// gasta bateria sin decir nada nuevo: un promotor en ruta no cambia
// de cuadra en veinte segundos.
const CADA_MS = 60_000
const CADA_M = 40

// Durante la comida: lo justo para saber que sigue por ahi.
const COMIDA_MS = 15 * 60_000
const COMIDA_M = 300

// Cada cuanto se intenta entregar lo que quedo en la cola.
const REINTENTO_MS = 30_000

export type Jornada = {
  id: string
  organizacion_id: string
  usuario_id: string
  inicio: string
  fin: string | null
}

/**
 * 'cerrada'   = todavia no hace su check-in de hoy
 * 'abierta'   = en jornada
 * 'terminada' = ya cerro su dia; no hay segundo check-in
 */
export type EstadoJornada = 'cerrada' | 'ocupado' | 'abierta' | 'terminada'

export type Comida = {
  id: string
  jornada_id: string
  inicio: string
  fin: string | null
  minutos_asignados: number
}

export function useJornada() {
  const [jornada, setJornada] = useState<Jornada | null>(null)
  const [estado, setEstado] = useState<EstadoJornada>('cerrada')
  const [pendientes, setPendientes] = useState(0)
  const [ultimo, setUltimo] = useState<Date | null>(null)
  const [aviso, setAviso] = useState('')
  const [listo, setListo] = useState(false)

  const [comida, setComida] = useState<Comida | null>(null)
  // Si ya la tomo hoy. Es una al dia, asi que una vez cerrada el boton
  // desaparece en vez de quedarse ofreciendo algo que la base rechaza.
  const [comidaTomada, setComidaTomada] = useState(false)

  const vigilante = useRef<Location.LocationSubscription | null>(null)
  // Con que cadencia esta midiendo ahora mismo, para no resuscribirse
  // en balde en cada repintado.
  const cadencia = useRef<'normal' | 'comida'>('normal')
  // La jornada en curso, para que el callback de ubicacion no se quede
  // con el valor que tenia cuando se suscribio.
  const actual = useRef<Jornada | null>(null)

  const guardarPunto = useCallback(async (pos: Location.LocationObject) => {
    const j = actual.current
    if (!j) return

    const punto: Punto = {
      jornada_id: j.id,
      usuario_id: j.usuario_id,
      organizacion_id: j.organizacion_id,
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      precision_m: pos.coords.accuracy ?? null,
      // El telefono reporta metros por segundo y -1 cuando no sabe.
      velocidad_kmh: pos.coords.speed != null && pos.coords.speed >= 0
        ? pos.coords.speed * 3.6 : null,
      rumbo: pos.coords.heading != null && pos.coords.heading >= 0
        ? pos.coords.heading : null,
      bateria: null,
      // Android avisa cuando la ubicacion viene de una aplicacion que
      // la simula. Se guarda tal cual: la oficina decide que hacer.
      ubicacion_simulada: pos.mocked === true,
      capturada_en: new Date(pos.timestamp).toISOString(),
    }

    await encolar(punto)

    // El mismo punto sirve para dos cosas: el rastro de la jornada y
    // vigilar que no se haya alejado de la tienda que esta visitando.
    // Un segundo GPS para esto seria el doble de bateria por el mismo
    // dato.
    revisar(pos)

    setUltimo(new Date(pos.timestamp))
    setPendientes(await vaciar())
    sincronizarAlertas().catch(() => {})
  }, [])

  const arrancarVigilante = useCallback(async (modo: 'normal' | 'comida' = 'normal') => {
    if (vigilante.current && cadencia.current === modo) return
    vigilante.current?.remove()
    vigilante.current = null
    cadencia.current = modo
    vigilante.current = await Location.watchPositionAsync(
      {
        accuracy: modo === 'comida' ? Location.Accuracy.Low : Location.Accuracy.Balanced,
        timeInterval: modo === 'comida' ? COMIDA_MS : CADA_MS,
        distanceInterval: modo === 'comida' ? COMIDA_M : CADA_M,
      },
      guardarPunto,
    )
  }, [guardarPunto])

  function pararVigilante() {
    vigilante.current?.remove()
    vigilante.current = null
  }

  // Quien avisa vive en avisos.ts; la vigilancia solo dice "se fue".
  useEffect(() => {
    alSalirse(metros => { avisarSalidaDeRadio(metros).catch(() => {}) })
    return () => alSalirse(null)
  }, [])

  // Al abrir la aplicacion: si quedo una jornada abierta —se cerro la
  // aplicacion, se reinicio el telefono— se retoma donde iba.
  useEffect(() => {
    let vivo = true
    ;(async () => {
      // La del dia, abierta o cerrada: hace falta distinguir "todavia
      // no empieza" de "ya termino".
      const hoy = new Date()
      const fechaHoy = new Date(hoy.getTime() - hoy.getTimezoneOffset() * 60000)
        .toISOString().slice(0, 10)
      const { data } = await supabase.from('jornada')
        .select('id,organizacion_id,usuario_id,inicio,fin')
        .eq('fecha', fechaHoy).maybeSingle()

      if (!vivo) return
      if (data && (data as Jornada).fin) {
        setJornada(data as Jornada)
        setEstado('terminada')
      } else if (data) {
        actual.current = data as Jornada
        setJornada(data as Jornada)
        setEstado('abierta')
        // Si se quedo comiendo y cerro la aplicacion, el contador
        // sigue donde iba: lo que manda es la hora de inicio que
        // quedo en la base, no un cronometro de la pantalla.
        // Todas las del dia, no solo la abierta: hace falta saber si
        // ya la tomo aunque ya haya vuelto.
        const { data: cms } = await supabase.from('comida')
          .select('id,jornada_id,inicio,fin,minutos_asignados')
          .eq('jornada_id', (data as Jornada).id)
        const lista = (cms ?? []) as Comida[]
        const cm = lista.find(x => !x.fin) ?? null
        if (cm) setComida(cm)
        setComidaTomada(lista.length > 0)

        const permiso = await Location.getForegroundPermissionsAsync()
        if (permiso.granted) arrancarVigilante(cm ? 'comida' : 'normal')
        else setAviso('La jornada sigue abierta pero el permiso de ubicación está apagado.')
      }
      setPendientes(await cuantosPendientes())
      setListo(true)
    })()
    return () => { vivo = false; pararVigilante() }
  }, [arrancarVigilante])

  // Reintento periodico: lo capturado sin senal se entrega en cuanto
  // vuelve, sin esperar al siguiente punto.
  useEffect(() => {
    if (estado !== 'abierta') return
    const t = setInterval(async () => setPendientes(await vaciar()), REINTENTO_MS)
    return () => clearInterval(t)
  }, [estado])

  // Volver a la aplicacion es la mejor senal de que puede haber red.
  useEffect(() => {
    const sub = AppState.addEventListener('change', async e => {
      if (e === 'active' && actual.current) setPendientes(await vaciar())
    })
    return () => sub.remove()
  }, [])

  /**
   * El check-in de seguridad: abre el dia dejando constancia de donde
   * estaba el promotor. La ubicacion se toma ANTES de llamar al
   * servidor, porque es el dato que le da sentido al registro; sin
   * ella seria el mismo boton de antes con otro nombre.
   */
  async function checkInSeguridad() {
    setAviso('')
    setEstado('ocupado')

    const permiso = await Location.requestForegroundPermissionsAsync()
    if (!permiso.granted) {
      setEstado('cerrada')
      setAviso('Sin permiso de ubicación no se puede hacer el check-in de seguridad. ' +
        'Actívalo en los ajustes del teléfono, en los permisos de esta aplicación.')
      return
    }

    let pos: Location.LocationObject | null = null
    try {
      pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
    } catch {
      // Adentro de un edificio el GPS tarda. No se le detiene el dia
      // por eso: se registra sin coordenadas y se avisa, que es mejor
      // que dejarlo sin poder trabajar.
    }

    // Es idempotente: si ya habia una jornada abierta la devuelve en
    // vez de fallar, asi que tocar dos veces no hace daño.
    const { data, error } = await supabase.rpc('check_in_seguridad', {
      p_lat: pos?.coords.latitude ?? null,
      p_lng: pos?.coords.longitude ?? null,
      p_precision: pos?.coords.accuracy ?? null,
    })
    if (error || !data) {
      setEstado('cerrada')
      setAviso('No se pudo hacer el check-in. Revisa que tengas señal e inténtalo otra vez.')
      return
    }

    const j = (Array.isArray(data) ? data[0] : data) as Jornada

    // La base ya no reabre una jornada cerrada: la devuelve como
    // esta. Si viene con hora de fin, el dia ya termino.
    if (j.fin) {
      setJornada(j)
      setEstado('terminada')
      setAviso('Ya terminaste tu jornada de hoy. El check-in es uno por día.')
      return
    }

    actual.current = j
    setJornada(j)
    setEstado('abierta')
    if (!pos) setAviso('El check-in quedó registrado, pero sin ubicación: el GPS no ' +
      'alcanzó a fijar. Sal a cielo abierto un momento.')

    // Un primer punto de inmediato: asi la oficina lo ve salir sin
    // esperar el primer minuto.
    if (pos) await guardarPunto(pos)
    arrancarVigilante()
  }

  async function cerrar() {
    setAviso('')
    setEstado('ocupado')
    pararVigilante()

    // Primero se entrega lo que falte: una vez cerrada, la jornada ya
    // no acepta puntos nuevos y el rastro quedaria mocho.
    setPendientes(await vaciar())

    const { error } = await supabase.rpc('cerrar_jornada', { motivo: 'manual' })
    if (error) {
      setEstado('abierta')
      arrancarVigilante()
      setAviso('No se pudo cerrar la jornada. Revisa que tengas señal e inténtalo otra vez.')
      return
    }

    actual.current = null
    setJornada(null)
    setUltimo(null)
    setComida(null)
    cadencia.current = 'normal'
    setEstado('cerrada')
  }

  // -------------------------------------------------------------------
  // La comida
  // -------------------------------------------------------------------

  /**
   * Empieza la comida. minutos viene del horario configurado y se
   * congela en el renglon: si manana le cambian el horario, lo que
   * paso hoy no cambia de sentido.
   */
  async function empezarComida(minutos: number) {
    const j = actual.current
    if (!j || comida || comidaTomada) return
    setAviso('')

    const { data, error } = await supabase.from('comida')
      .insert({ jornada_id: j.id, minutos_asignados: minutos })
      .select('id,jornada_id,inicio,fin,minutos_asignados').single()

    if (error || !data) {
      // La base tambien lo impide: si el telefono se quedo con un
      // estado viejo, el indice unico es la ultima palabra.
      const yaFue = (error?.message ?? '').toLowerCase().includes('duplicate')
      setComidaTomada(yaFue || comidaTomada)
      setAviso(yaFue
        ? 'Ya tomaste tu comida hoy. Es una por día.'
        : 'No se pudo registrar tu comida. Revisa que tengas señal.')
      return
    }
    setComida(data as Comida)
    setComidaTomada(true)
    arrancarVigilante('comida')

    // El aviso de que se le acaba. Se calcula desde la hora que
    // devolvio la base, no desde el reloj de la pantalla: si el
    // telefono trae la hora corrida, el contador y el aviso tienen
    // que correrse igual.
    const fin = new Date(new Date((data as Comida).inicio).getTime() + minutos * 60_000)
    avisarFinDeComida(new Date(fin.getTime() - AVISO_COMIDA_MIN * 60_000)).catch(() => {})
  }

  /**
   * Termina la comida. Se llama DESPUES de que la foto de regreso
   * quedo guardada en el telefono, no despues de que subio: adentro
   * de un patio de comidas no hay señal, y dejar al promotor sin
   * poder volver a trabajar por eso seria absurdo.
   */
  async function terminarComida() {
    const cm = comida
    if (!cm) return
    setAviso('')

    const { error } = await supabase.from('comida')
      .update({ fin: new Date().toISOString() }).eq('id', cm.id)

    if (error) {
      setAviso('No se pudo cerrar tu comida. Revisa que tengas señal e inténtalo otra vez.')
      return
    }
    setComida(null)
    olvidarAvisoDeComida().catch(() => {})
    arrancarVigilante('normal')
  }

  return {
    estado, jornada, pendientes, ultimo, aviso, listo, comida, comidaTomada,
    checkInSeguridad, cerrar, empezarComida, terminarComida,
  }
}
