import { useEffect, useState } from 'react'
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native'
import { c, f, CIFRAS } from './tema'
import { useJornada } from './jornada'

// =====================================================================
// La jornada, arriba del itinerario
//
// Es lo primero que hace el promotor en la manana y lo ultimo en la
// tarde, asi que va antes que la ruta y ocupa el ancho completo.
//
// El canto de color lleva el estado: verde cuando el rastro va al
// corriente, naranja cuando hace rato que no se manda un punto o hay
// cola pendiente. Esa distincion importa — una jornada abierta que no
// esta reportando se ve igual que una sana si no se dice.
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

export default function BarraJornada() {
  const { estado, jornada, pendientes, ultimo, aviso, listo, iniciar, cerrar } = useJornada()

  // Los textos son relativos al reloj, asi que la tarjeta se repinta
  // sola aunque no llegue nada nuevo.
  const [, repintar] = useState(0)
  useEffect(() => {
    if (estado !== 'abierta') return
    const t = setInterval(() => repintar(n => n + 1), 30_000)
    return () => clearInterval(t)
  }, [estado])

  if (!listo) return null

  const retrasado = estado === 'abierta' && (
    pendientes > 0 ||
    (ultimo != null && Date.now() - ultimo.getTime() > RETRASO_MIN * 60_000) ||
    ultimo == null
  )

  const abierta = estado === 'abierta'
  const canto = !abierta ? c.neutro : retrasado ? c.naranja : c.exito

  return (
    <View style={[s.tarjeta, { borderLeftColor: canto }]}>
      <View style={s.renglon}>
        <Text style={[s.rotulo, abierta && (retrasado ? s.rotuloAlerta : s.rotuloVivo)]}>
          {abierta ? 'EN JORNADA' : 'JORNADA CERRADA'}
        </Text>
        {abierta && jornada && (
          <Text style={s.reloj}>{transcurrido(jornada.inicio)}</Text>
        )}
      </View>

      <Text style={s.detalle} accessibilityLiveRegion="polite">
        {!abierta
          ? 'Ábrela al salir de casa. Mientras esté abierta, la oficina ve por dónde vas.'
          : pendientes > 0
            ? `${pendientes} ${pendientes === 1 ? 'punto guardado' : 'puntos guardados'} ` +
              'en el teléfono. Se mandan solos en cuanto haya señal.'
            : ultimo
              ? `Último punto ${haceCuanto(ultimo)}.`
              : 'Buscando la señal del GPS…'}
      </Text>

      {aviso !== '' && (
        <View style={s.aviso} accessibilityLiveRegion="polite">
          <Text style={s.avisoTexto}>{aviso}</Text>
        </View>
      )}

      <Pressable
        style={({ pressed }) => [s.boton, abierta && s.botonCerrar, pressed && s.presionado]}
        onPress={abierta ? cerrar : iniciar}
        disabled={estado === 'ocupado'}
        accessibilityRole="button"
        accessibilityLabel={abierta ? 'Terminar la jornada' : 'Iniciar la jornada'}
        accessibilityState={{ busy: estado === 'ocupado' }}>
        {estado === 'ocupado'
          ? <ActivityIndicator color={abierta ? c.azul : c.blanco} />
          : (
            <Text style={[s.botonTexto, abierta && s.botonTextoCerrar]}>
              {abierta ? 'TERMINAR JORNADA' : 'INICIAR JORNADA'}
            </Text>
          )}
      </Pressable>
    </View>
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
  reloj: { fontFamily: f.displaySemi, fontSize: 15, color: c.tinta2, ...CIFRAS },

  detalle: { fontFamily: f.texto, fontSize: 13.5, color: c.tinta2, lineHeight: 19 },

  boton: { backgroundColor: c.azul, borderRadius: 9, minHeight: 50,
    alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  // Terminar no es la accion que se busca a ciegas: se queda en
  // secundario para que no se toque por error a media manana.
  botonCerrar: { backgroundColor: c.blanco, borderWidth: 1.5, borderColor: c.azul },
  presionado: { opacity: 0.85 },
  botonTexto: { fontFamily: f.display, color: c.blanco, fontSize: 15.5, letterSpacing: 0.9 },
  botonTextoCerrar: { color: c.azul },

  aviso: { backgroundColor: c.errorSuave, borderWidth: 1, borderColor: c.errorBorde,
    borderRadius: 8, padding: 10 },
  avisoTexto: { fontFamily: f.texto, color: c.errorTexto, fontSize: 13, lineHeight: 18 },
})
