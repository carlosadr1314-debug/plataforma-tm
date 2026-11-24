import { Platform } from 'react-native'
import * as Notifications from 'expo-notifications'
import { AndroidImportance } from 'expo-notifications'
import { ANTICIPACION_MIN, avisosAProgramar, type Horario } from './horario'

// =====================================================================
// Los avisos del check-in de seguridad
//
// Son de reloj, no del servidor: el telefono ya sabe a que hora es la
// primera visita, asi que no hace falta que nadie le mande nada. Eso
// tambien quiere decir que llegan sin señal, que es justo cuando mas
// falta hacen.
//
// Dos: dos horas antes y una hora antes de la primera visita. La
// segunda coincide con la hora limite del check-in, asi que no es un
// recordatorio sino la ultima llamada.
//
// OJO CON EXPO GO: ahi los avisos se programan pero no se entregan de
// forma confiable, sobre todo en iOS y con la aplicacion cerrada. Para
// que un promotor reciba de verdad un aviso a las siete de la manana
// hace falta una compilacion de EAS. El codigo queda listo; lo que no
// se puede es probarlo en Expo Go y concluir nada de ahi.
// =====================================================================

const CANAL = 'checkin'
/** Para reconocer los nuestros y no cancelar los de alguien mas. */
const PREFIJO = 'tm.checkin.'

/** La aplicacion abierta tambien los muestra: si no, parecen perdidos. */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
})

let canalListo = false
async function prepararCanal() {
  if (canalListo || Platform.OS !== 'android') return
  await Notifications.setNotificationChannelAsync(CANAL, {
    name: 'Check-in de seguridad',
    importance: AndroidImportance.HIGH,
    sound: 'default',
    vibrationPattern: [0, 250, 250, 250],
  })
  canalListo = true
}

/** Pide el permiso. Se llama al abrir el dia, no al arrancar. */
export async function permisoAvisos(): Promise<boolean> {
  const actual = await Notifications.getPermissionsAsync()
  if (actual.granted) return true
  if (!actual.canAskAgain) return false
  const pedido = await Notifications.requestPermissionsAsync()
  return pedido.granted
}

async function cancelarLosNuestros() {
  try {
    const puestos = await Notifications.getAllScheduledNotificationsAsync()
    await Promise.all(
      puestos
        .filter(n => n.identifier.startsWith(PREFIJO))
        .map(n => Notifications.cancelScheduledNotificationAsync(n.identifier)),
    )
  } catch { /* sin avisos puestos, nada que cancelar */ }
}

function textoAviso(minutos: number, hora: string) {
  if (minutos <= ANTICIPACION_MIN) {
    return {
      title: 'Última llamada para tu check-in',
      body: `Tu primera visita es a las ${hora}. El check-in de seguridad se ` +
            'hace ahora: después ya vas tarde.',
    }
  }
  return {
    title: 'No olvides tu check-in de seguridad',
    body: `Tu primera visita es a las ${hora}. Tienes que hacer el check-in ` +
          `al menos ${ANTICIPACION_MIN} minutos antes.`,
  }
}

/**
 * Deja puestos los avisos del dia. Se vuelve a llamar cuando cambia la
 * ruta o el horario: primero cancela los suyos, asi que llamarlo de
 * mas no apila avisos repetidos.
 *
 * No programa nada si ya hizo el check-in —no hay que recordarle algo
 * que ya hizo— ni si la hora ya paso, porque un aviso para un momento
 * anterior se entrega de inmediato y asusta sin servir.
 */
export async function programarAvisos(opciones: {
  primeraVisita: string | null
  horario: Horario | null
  yaHizoCheckIn: boolean
}): Promise<number> {
  await cancelarLosNuestros()

  const { primeraVisita, horario, yaHizoCheckIn } = opciones
  if (yaHizoCheckIn) return 0

  const refe = primeraVisita ?? horario?.entrada ?? null
  const tocan = avisosAProgramar({ referencia: refe, yaHizoCheckIn })
  if (tocan.length === 0 || !refe) return 0

  if (!(await permisoAvisos())) return 0
  await prepararCanal()

  let puestos = 0

  for (const { minutos: min, cuando } of tocan) {
    try {
      await Notifications.scheduleNotificationAsync({
        identifier: `${PREFIJO}${min}`,
        content: { ...textoAviso(min, refe), sound: 'default' },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: cuando,
          ...(Platform.OS === 'android' ? { channelId: CANAL } : {}),
        },
      })
      puestos += 1
    } catch { /* uno que no entre no debe tumbar al otro */ }
  }

  return puestos
}

/** Al hacer el check-in sobran: se quitan para no sonar de balde. */
export async function olvidarAvisos() {
  await cancelarLosNuestros()
}
