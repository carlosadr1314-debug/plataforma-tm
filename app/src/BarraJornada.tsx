import { useCallback, useEffect, useState } from 'react'
import { View, Text, Pressable, StyleSheet, ActivityIndicator, Alert } from 'react-native'
import { c, f, CIFRAS, TOCABLE } from './tema'
import { type useJornada } from './jornada'
import { tomarFoto } from './fotos'
import { sincronizar } from './sinSenal'
import {
  horarioDeHoy, limiteCheckIn, efectivas, enHoras, hhmm, ANTICIPACION_MIN,
  type Horario,
} from './horario'
import { programarAvisos, olvidarAvisos } from './avisos'

// =====================================================================
// El dia del promotor, arriba del itinerario
//
// Tres estados, y en cada uno una sola cosa que hacer:
//
//   · Antes de salir: el check-in de seguridad. Es obligatorio y tiene
//     hora limite —una hora antes de la primera visita—, asi que la
//     tarjeta dice cuanto falta y se pone naranja cuando ya se paso.
//   · En jornada: cuanto lleva, si el rastro va al corriente, y el
//     boton de comida.
//   · En comida: el contador de lo que le queda. Para volver hay que
//     tomar foto, que es la constancia de que ya esta trabajando.
//
// El canto de color lleva el estado y se lee de reojo, sin enfocar.
// =====================================================================

// Pasado esto sin un punto nuevo, algo anda mal: el telefono perdio el
// GPS, se apago el permiso o la aplicacion quedo congelada.
const RETRASO_MIN = 6

function transcurrido(desde: string) {
  const min = Math.max(0, Math.floor((Date.now() - new Date(desde).getTime()) / 60000))
  const h = Math.floor(min / 60)
  return h > 0 ? `${h} h ${min % 60} min` : `${min} min`
}

function haceCuanto(d: Date) {
  const min = Math.floor((Date.now() - d.getTime()) / 60000)
  if (min < 1) return 'hace un momento'
  if (min === 1) return 'hace 1 minuto'
  return `hace ${min} minutos`
}

const reloj = (d: Date) =>
  d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false })

/** Minutos que le quedan de comida. Negativo si ya se paso. */
function restanComida(inicio: string, minutos: number) {
  const fin = new Date(inicio).getTime() + minutos * 60_000
  return Math.round((fin - Date.now()) / 60_000)
}

type Props = {
  /** Hora de la primera visita del dia, "HH:MM". Fija la hora limite. */
  primeraVisita: string | null
  /**
   * El estado de la jornada llega de arriba y no se pide aqui: el
   * itinerario tambien lo necesita para no dejar abrir una visita sin
   * check-in, y dos useJornada() serian dos vigilantes de GPS
   * corriendo a la vez.
   */
  dia: ReturnType<typeof useJornada>
}

export default function BarraJornada({ primeraVisita, dia }: Props) {
  const {
    estado, jornada, pendientes, ultimo, aviso, listo, comida,
    checkInSeguridad, cerrar, empezarComida, terminarComida,
  } = dia

  const [horario, setHorario] = useState<Horario | null | undefined>(undefined)
  const [volviendo, setVolviendo] = useState(false)

  // Los textos son relativos al reloj, asi que la tarjeta se repinta
  // sola aunque no llegue nada nuevo. En comida mas seguido: ahi el
  // numero que importa cambia cada minuto.
  const [, repintar] = useState(0)
  useEffect(() => {
    const cada = comida ? 20_000 : 30_000
    const t = setInterval(() => repintar(n => n + 1), cada)
    return () => clearInterval(t)
  }, [comida])

  useEffect(() => {
    const hoy = new Date().toISOString().slice(0, 10)
    horarioDeHoy(hoy).then(setHorario).catch(() => setHorario(undefined))
  }, [])

  // Los avisos se reponen cuando cambia algo de lo que dependen. Como
  // programarAvisos() cancela los suyos antes de poner los nuevos,
  // repetirlo no apila avisos duplicados.
  useEffect(() => {
    if (!listo || horario === undefined) return
    programarAvisos({
      primeraVisita,
      horario: horario ?? null,
      yaHizoCheckIn: estado === 'abierta',
    }).catch(() => {})
  }, [listo, horario, primeraVisita, estado])

  const abierta = estado === 'abierta'
  const enComida = !!comida

  /**
   * Volver de comer pide foto. Se exige que quede GUARDADA en el
   * telefono, no que haya subido: en un patio de comidas no hay señal,
   * y dejar al promotor sin poder volver a trabajar por eso seria
   * absurdo. La foto sale sola despues.
   */
  const hacerCheckIn = useCallback(async () => {
    await checkInSeguridad()
    // Ya no hay que recordarle algo que acaba de hacer. El efecto de
    // arriba tambien lo cubre, pero esto es inmediato y no depende de
    // que el estado alcance a repintar.
    olvidarAvisos().catch(() => {})
  }, [checkInSeguridad])

  const volverDeComer = useCallback(async () => {
    if (!jornada || volviendo) return
    setVolviendo(true)
    const r = await tomarFoto({ tipo: 'regreso_comida', jornadaId: jornada.id })
    if (!r.ok) {
      setVolviendo(false)
      if (!r.cancelada) Alert.alert('No se pudo tomar la foto', r.error)
      return
    }
    await terminarComida()
    setVolviendo(false)
    sincronizar().catch(() => {})
  }, [jornada, volviendo, terminarComida])

  function preguntarComida() {
    const min = horario?.minutos_comida ?? 60
    Alert.alert(
      'Tomar tu comida',
      `Te tocan ${min} minutos. Para volver vas a tener que tomar una foto.`,
      [
        { text: 'Todavía no', style: 'cancel' },
        { text: 'Empezar', onPress: () => empezarComida(min) },
      ],
    )
  }

  if (!listo) return null

  const retrasado = abierta && !enComida && (
    pendientes > 0 ||
    (ultimo != null && Date.now() - ultimo.getTime() > RETRASO_MIN * 60_000) ||
    ultimo == null
  )

  const limite = limiteCheckIn(primeraVisita, horario ?? null)
  const tarde = !abierta && limite != null && Date.now() > limite.getTime()
  const restan = comida ? restanComida(comida.inicio, comida.minutos_asignados) : 0
  const pasado = enComida && restan < 0

  const canto = enComida ? (pasado ? c.naranja : c.azul)
    : !abierta ? (tarde ? c.naranja : c.neutro)
    : retrasado ? c.naranja : c.exito

  return (
    <View style={[s.tarjeta, { borderLeftColor: canto }]}>
      <View style={s.renglon}>
        <Text style={[s.rotulo,
                      enComida ? s.rotuloComida
                        : abierta ? (retrasado ? s.rotuloAlerta : s.rotuloVivo)
                        : tarde ? s.rotuloAlerta : null]}>
          {enComida ? 'EN COMIDA' : abierta ? 'EN JORNADA' : 'SIN CHECK-IN'}
        </Text>
        {enComida && comida ? (
          <Text style={[s.reloj, pasado && s.relojPasado]}>
            {pasado ? `+${Math.abs(restan)} min` : `${restan} min`}
          </Text>
        ) : abierta && jornada ? (
          <Text style={s.reloj}>{transcurrido(jornada.inicio)}</Text>
        ) : null}
      </View>

      {/* El horario del dia. Es lo que vino a cumplir. */}
      {horario && (
        <Text style={s.horario}>
          Hoy: {hhmm(horario.entrada)} a {hhmm(horario.salida)}
          {'  ·  '}{enHoras(efectivas(horario))} efectivas
          {horario.minutos_comida > 0 && `  ·  ${horario.minutos_comida} min de comida`}
        </Text>
      )}
      {horario === null && (
        <Text style={s.horario}>Hoy no tienes horario asignado.</Text>
      )}

      <Text style={s.detalle} accessibilityLiveRegion="polite">
        {enComida && comida
          ? (pasado
              ? `Tu comida terminó hace ${Math.abs(restan)} min. Toma la foto para volver.`
              : `Empezaste a las ${reloj(new Date(comida.inicio))}. ` +
                'Para volver vas a tomar una foto.')
          : !abierta
            ? (limite
                ? `Hazlo antes de las ${reloj(limite)}` +
                  (primeraVisita
                    ? `, ${ANTICIPACION_MIN} min antes de tu primera visita de las ${primeraVisita}.`
                    : '.')
                : 'Hazlo al salir de casa. Desde aquí tu supervisor sabe que ya vas en camino.')
            : pendientes > 0
              ? `${pendientes} ${pendientes === 1 ? 'punto guardado' : 'puntos guardados'} ` +
                'en el teléfono. Se mandan solos en cuanto haya señal.'
              : ultimo
                ? `Último punto ${haceCuanto(ultimo)}.`
                : 'Buscando la señal del GPS…'}
      </Text>

      {tarde && (
        <View style={s.alerta} accessibilityLiveRegion="polite">
          <Text style={s.alertaTexto}>
            Ya pasó la hora de tu check-in. Hazlo ahora y avísale a tu supervisor.
          </Text>
        </View>
      )}

      {aviso !== '' && (
        <View style={s.aviso} accessibilityLiveRegion="polite">
          <Text style={s.avisoTexto}>{aviso}</Text>
        </View>
      )}

      {/* --- la accion --- */}
      {enComida ? (
        <Boton texto="YA REGRESÉ" ocupado={volviendo} onPress={volverDeComer}
               etiqueta="Terminar la comida y tomar la foto de regreso" />
      ) : !abierta ? (
        <Boton texto="HACER CHECK-IN" ocupado={estado === 'ocupado'}
               onPress={hacerCheckIn} etiqueta="Hacer el check-in de seguridad" />
      ) : (
        <>
          {(horario?.minutos_comida ?? 0) > 0 && (
            <Boton texto="TOMAR MI COMIDA" secundario onPress={preguntarComida}
                   etiqueta="Empezar el tiempo de comida" />
          )}
          <Boton texto="TERMINAR JORNADA" secundario
                 onPress={cerrar} etiqueta="Terminar la jornada" />
        </>
      )}
    </View>
  )
}

function Boton({ texto, onPress, ocupado, secundario, etiqueta }: {
  texto: string; onPress: () => void
  ocupado?: boolean; secundario?: boolean; etiqueta: string
}) {
  return (
    <Pressable
      style={({ pressed }) => [s.boton, secundario && s.botonSec, pressed && s.presionado]}
      onPress={onPress} disabled={ocupado}
      accessibilityRole="button" accessibilityLabel={etiqueta}
      accessibilityState={{ busy: !!ocupado }}>
      {ocupado
        ? <ActivityIndicator color={secundario ? c.azul : c.blanco} />
        : <Text style={[s.botonTexto, secundario && s.botonTextoSec]}>{texto}</Text>}
    </Pressable>
  )
}

const s = StyleSheet.create({
  tarjeta: {
    backgroundColor: c.blanco, borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: c.borde,
    // El canto de color es el estado; va mas grueso que el borde para
    // que se lea de reojo sin tener que enfocar la tarjeta.
    borderLeftWidth: 6,
    gap: 8, marginBottom: 14,
  },
  renglon: { flexDirection: 'row', alignItems: 'baseline',
    justifyContent: 'space-between', gap: 10 },

  rotulo: { fontFamily: f.display, fontSize: 15, letterSpacing: 0.8,
    color: c.neutroTexto },
  rotuloVivo: { color: c.exitoTexto },
  rotuloAlerta: { color: c.naranjaTexto },
  rotuloComida: { color: c.azul },
  reloj: { fontFamily: f.displaySemi, fontSize: 15, color: c.tinta2, ...CIFRAS },
  relojPasado: { color: c.naranjaTexto },

  horario: { fontFamily: f.texto, fontSize: 12.5, color: c.tinta2, lineHeight: 17,
    ...CIFRAS },
  detalle: { fontFamily: f.texto, fontSize: 13.5, color: c.tinta2, lineHeight: 19 },

  boton: { backgroundColor: c.azul, borderRadius: 9, minHeight: TOCABLE,
    alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  // Terminar y comer no son acciones que se busquen a ciegas: se
  // quedan en secundario para que no se toquen por error.
  botonSec: { backgroundColor: c.blanco, borderWidth: 1.5, borderColor: c.azul },
  presionado: { opacity: 0.85 },
  botonTexto: { fontFamily: f.display, color: c.blanco, fontSize: 15.5, letterSpacing: 0.9 },
  botonTextoSec: { color: c.azul },

  alerta: { backgroundColor: c.naranjaSuave, borderWidth: 1, borderColor: c.naranja,
    borderRadius: 8, padding: 10 },
  alertaTexto: { fontFamily: f.texto, color: c.naranjaTexto, fontSize: 13, lineHeight: 18 },

  aviso: { backgroundColor: c.errorSuave, borderWidth: 1, borderColor: c.errorBorde,
    borderRadius: 8, padding: 10 },
  avisoTexto: { fontFamily: f.texto, color: c.errorTexto, fontSize: 13, lineHeight: 18 },
})
