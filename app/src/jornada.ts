import { useCallback, useEffect, useRef, useState } from 'react'
import { AppState } from 'react-native'
import * as Location from 'expo-location'
import { supabase } from './supabase'
import { encolar, vaciar, cuantosPendientes, type Punto } from './cola'

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
// =====================================================================

// Un punto por minuto, o antes si se movio 40 metros. Mas seguido
// gasta bateria sin decir nada nuevo: un promotor en ruta no cambia
// de cuadra en veinte segundos.
const CADA_MS = 60_000
const CADA_M = 40

// Cada cuanto se intenta entregar lo que quedo en la cola.
const REINTENTO_MS = 30_000

export type Jornada = {
  id: string
  organizacion_id: string
  usuario_id: string
  inicio: string
  fin: string | null
}

export type EstadoJornada = 'cerrada' | 'ocupado' | 'abierta'

export function useJornada() {
  const [jornada, setJornada] = useState<Jornada | null>(null)
  const [estado, setEstado] = useState<EstadoJornada>('cerrada')
  const [pendientes, setPendientes] = useState(0)
  const [ultimo, setUltimo] = useState<Date | null>(null)
  const [aviso, setAviso] = useState('')
  const [listo, setListo] = useState(false)

  const vigilante = useRef<Location.LocationSubscription | null>(null)
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
    setUltimo(new Date(pos.timestamp))
    setPendientes(await vaciar())
  }, [])

  const arrancarVigilante = useCallback(async () => {
    if (vigilante.current) return
    vigilante.current = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.Balanced, timeInterval: CADA_MS, distanceInterval: CADA_M },
      guardarPunto,
    )
  }, [guardarPunto])

  function pararVigilante() {
    vigilante.current?.remove()
    vigilante.current = null
  }

  // Al abrir la aplicacion: si quedo una jornada abierta —se cerro la
  // aplicacion, se reinicio el telefono— se retoma donde iba.
  useEffect(() => {
    let vivo = true
    ;(async () => {
      const { data } = await supabase.from('jornada')
        .select('id,organizacion_id,usuario_id,inicio,fin')
        .is('fin', null).maybeSingle()

      if (!vivo) return
      if (data) {
        actual.current = data as Jornada
        setJornada(data as Jornada)
        setEstado('abierta')
        const permiso = await Location.getForegroundPermissionsAsync()
        if (permiso.granted) arrancarVigilante()
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

  async function iniciar() {
    setAviso('')
    setEstado('ocupado')

    const permiso = await Location.requestForegroundPermissionsAsync()
    if (!permiso.granted) {
      setEstado('cerrada')
      setAviso('Sin permiso de ubicación no se puede abrir la jornada. ' +
        'Actívalo en los ajustes del teléfono, en los permisos de esta aplicación.')
      return
    }

    // iniciar_jornada() es idempotente: si ya habia una abierta la
    // devuelve en vez de fallar, asi que tocar dos veces no hace dano.
    const { data, error } = await supabase.rpc('iniciar_jornada')
    if (error || !data) {
      setEstado('cerrada')
      setAviso('No se pudo abrir la jornada. Revisa que tengas señal e inténtalo otra vez.')
      return
    }

    const j = data as Jornada
    actual.current = j
    setJornada(j)
    setEstado('abierta')

    // Un primer punto de inmediato: asi la oficina lo ve salir sin
    // esperar el primer minuto.
    try {
      const pos = await Location.getCurrentPositionAsync(
        { accuracy: Location.Accuracy.Balanced })
      await guardarPunto(pos)
    } catch {
      // Dentro de un edificio puede tardar en fijar. El vigilante lo
      // agarra en cuanto haya senal de GPS.
    }
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
    setEstado('cerrada')
  }

  return { estado, jornada, pendientes, ultimo, aviso, listo, iniciar, cerrar }
}
