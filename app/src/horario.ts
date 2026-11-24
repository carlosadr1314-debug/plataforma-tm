import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase } from './supabase'

// =====================================================================
// El horario que le toca cumplir
//
// Lo configura la oficina como plantilla semanal y el promotor lo ve
// al abrir el dia. Aqui vive lo que el telefono necesita saber de el:
// cual es el de hoy, a que hora tiene que estar listo, y cuanto le
// toca de comida.
//
// Se guarda en el telefono igual que la ruta: si no hay señal, el
// promotor sigue sabiendo a que hora entra. Un horario de ayer no
// sirve, asi que se guarda con su fecha.
// =====================================================================

const LLAVE_HORARIO = 'tm.horario'

/** Cuanto antes de la primera visita hay que hacer el check-in. */
export const ANTICIPACION_MIN = 60
/** Cuando se avisa, en minutos antes de la primera visita. */
export const AVISOS_MIN = [120, 60]

export type Horario = {
  fecha: string
  entrada: string          // "HH:MM"
  salida: string           // "HH:MM"
  minutos_comida: number
}

async function guardar(fecha: string, h: Horario | null) {
  try {
    await AsyncStorage.setItem(LLAVE_HORARIO, JSON.stringify({ fecha, h }))
  } catch { /* ni modo */ }
}

async function leerGuardado(fecha: string): Promise<Horario | null | undefined> {
  try {
    const crudo = await AsyncStorage.getItem(LLAVE_HORARIO)
    if (!crudo) return undefined
    const g = JSON.parse(crudo) as { fecha: string; h: Horario | null }
    // Solo el de hoy. Uno de ayer confunde mas de lo que ayuda.
    return g.fecha === fecha ? g.h : undefined
  } catch { return undefined }
}

/**
 * El horario de hoy. Devuelve null cuando hoy no trabaja, y undefined
 * cuando no se pudo averiguar —ni por red ni por lo guardado—, que no
 * es lo mismo: lo primero se dice, lo segundo se calla.
 */
export async function horarioDeHoy(fecha: string): Promise<Horario | null | undefined> {
  const { data, error } = await supabase.rpc('mi_horario')
  if (error) return leerGuardado(fecha)

  const fila = Array.isArray(data) ? data[0] : data
  if (!fila) { await guardar(fecha, null); return null }

  const h: Horario = {
    fecha,
    entrada: String(fila.entrada).slice(0, 5),
    salida: String(fila.salida).slice(0, 5),
    minutos_comida: Number(fila.minutos_comida) || 0,
  }
  await guardar(fecha, h)
  return h
}

// ---------------------------------------------------------------------
// Cuentas de reloj
// ---------------------------------------------------------------------

/** "HH:MM" de hoy, como fecha del telefono. */
export function hoyALas(hhmm: string, base = new Date()): Date {
  const [h, m] = hhmm.split(':').map(Number)
  const d = new Date(base)
  d.setHours(h || 0, m || 0, 0, 0)
  return d
}

export function minutosEntre(a: string, b: string) {
  const [ha, ma] = a.split(':').map(Number)
  const [hb, mb] = b.split(':').map(Number)
  return (hb * 60 + mb) - (ha * 60 + ma)
}

/** "7 h 30 min", "45 min". Para leerse, no para calcular. */
export function enHoras(min: number) {
  const m = Math.max(0, Math.round(min))
  const h = Math.floor(m / 60), r = m % 60
  if (h === 0) return `${r} min`
  return r === 0 ? `${h} h` : `${h} h ${r} min`
}

/** Las horas efectivas del dia, ya descontada la comida. */
export function efectivas(h: Horario) {
  return Math.max(0, minutosEntre(h.entrada, h.salida) - h.minutos_comida)
}

/**
 * La hora limite para el check-in de seguridad: una hora antes de la
 * primera visita. Si el dia no trae visitas con hora, se cae a la
 * entrada del horario.
 */
export function limiteCheckIn(primeraVisita: string | null, h: Horario | null): Date | null {
  const refe = primeraVisita ?? h?.entrada ?? null
  if (!refe) return null
  return new Date(hoyALas(refe).getTime() - ANTICIPACION_MIN * 60_000)
}

/** "12:30" a partir de una hora del servidor, que puede traer segundos. */
export const hhmm = (t: string | null | undefined) =>
  t ? String(t).slice(0, 5) : ''
