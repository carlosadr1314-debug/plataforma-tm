import { useEffect, useState, useCallback } from 'react'
import {
  View, Text, FlatList, Pressable, StyleSheet,
  RefreshControl, ActivityIndicator,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { supabase } from './supabase'
import { c, f, TOCABLE, SEPARACION, CIFRAS } from './tema'

type Parada = {
  id: string
  hora_estimada: string | null
  pdv: { codigo: string; nombre: string; direccion: string | null; ciudad: string | null } | null
  tarea: { nombre: string } | null
  visita: any
}

// La fecha del telefono, no la del servidor: el promotor ve su propio dia.
function hoyLocal() {
  const d = new Date()
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
}

// Solo la primera letra en mayuscula. textTransform 'capitalize' de
// React Native pondria "Lunes, 2 De Noviembre".
function fechaLarga() {
  const t = new Date().toLocaleDateString('es-MX',
    { weekday: 'long', day: 'numeric', month: 'long' })
  return t.charAt(0).toUpperCase() + t.slice(1)
}

// La visita puede llegar como objeto o como lista de un elemento,
// segun como resuelva la relacion el servidor.
const unaVisita = (v: any) => (Array.isArray(v) ? v[0] : v) ?? null

const ESTADO: Record<string, { txt: string; fondo: string; texto: string; canto: string }> = {
  completada:   { txt: 'COMPLETADA',   fondo: c.exitoSuave,   texto: c.exitoTexto,   canto: c.exito },
  en_curso:     { txt: 'EN CURSO',     fondo: c.naranjaSuave, texto: c.naranjaTexto, canto: c.naranja },
  no_realizada: { txt: 'NO REALIZADA', fondo: c.errorSuave,   texto: c.errorTexto,   canto: c.error },
  pendiente:    { txt: 'PENDIENTE',    fondo: c.neutroSuave,  texto: c.neutroTexto,  canto: c.neutro },
}

export default function Itinerario() {
  const [paradas, setParadas] = useState<Parada[]>([])
  const [nombre, setNombre] = useState('')
  const [cargando, setCargando] = useState(true)
  const [refrescando, setRefrescando] = useState(false)
  const [error, setError] = useState('')

  const cargar = useCallback(async () => {
    setError('')
    const { data: u } = await supabase.auth.getUser()
    if (u.user) {
      const { data: perfil } = await supabase.from('usuario')
        .select('nombre').eq('id', u.user.id).maybeSingle()
      if (perfil) setNombre(perfil.nombre)
    }

    // El aislamiento lo hace la base: esta consulta no filtra por
    // usuario, las politicas de seguridad solo devuelven su ruta.
    const { data, error: err } = await supabase.from('itinerario')
      .select(`id,hora_estimada,
               pdv:pdv_id(codigo,nombre,direccion,ciudad),
               tarea:tarea_id(nombre),
               visita(id,estado,check_in,check_out)`)
      .eq('fecha_programada', hoyLocal())
      .order('hora_estimada')

    if (err) setError('No se pudo cargar tu ruta. Revisa tu conexion y desliza hacia abajo para reintentar.')
    setParadas((data as any) ?? [])
  }, [])

  useEffect(() => { cargar().finally(() => setCargando(false)) }, [cargar])

  async function refrescar() {
    setRefrescando(true)
    await cargar()
    setRefrescando(false)
  }

  const estadoDe = (p: Parada) => unaVisita(p.visita)?.estado ?? 'pendiente'
  const hechas = paradas.filter(p => estadoDe(p) === 'completada').length
  const curso  = paradas.filter(p => estadoDe(p) === 'en_curso').length
  const faltan = paradas.length - hechas - curso

  if (cargando) {
    return (
      <SafeAreaView style={[s.pantalla, s.centrado]} edges={['top', 'bottom']}>
        <ActivityIndicator color={c.azul} size="large" />
        <Text style={s.cargandoTexto}>Cargando tu ruta…</Text>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={s.pantalla} edges={['top', 'bottom', 'left', 'right']}>
      <View style={s.cabecera}>
        <Text style={s.titulo}>MI RUTA DE HOY</Text>
        <Text style={s.subtitulo}>
          {fechaLarga()}{nombre ? ' · ' + nombre : ''}
        </Text>
      </View>

      <FlatList
        data={paradas}
        keyExtractor={p => p.id}
        contentContainerStyle={s.lista}
        refreshControl={
          <RefreshControl refreshing={refrescando} onRefresh={refrescar} tintColor={c.azul} />
        }
        ListHeaderComponent={
          <>
            {error !== '' && (
              <View style={s.aviso} accessibilityLiveRegion="polite">
                <Text style={s.avisoTexto}>{error}</Text>
              </View>
            )}
            {paradas.length > 0 && (
              <View style={s.resumen}>
                <Dato valor={hechas} etiqueta="HECHAS" />
                <Dato valor={curso}  etiqueta="EN CURSO" />
                <Dato valor={faltan} etiqueta="FALTAN" />
              </View>
            )}
          </>
        }
        ListEmptyComponent={
          <View style={s.vacio}>
            <Text style={s.vacioTitulo}>No tienes visitas hoy</Text>
            <Text style={s.vacioTexto}>
              Tu ruta la programa la oficina. Si esperabas visitas, desliza
              hacia abajo para volver a consultar.
            </Text>
          </View>
        }
        renderItem={({ item, index }) => {
          const e = ESTADO[estadoDe(item)] ?? ESTADO.pendiente
          const v = unaVisita(item.visita)
          const hora = item.hora_estimada?.slice(0, 5) ?? '—'
          return (
            <Pressable
              style={({ pressed }) => [
                s.tarjeta, { borderLeftColor: e.canto }, pressed && s.tarjetaPresionada,
              ]}
              accessibilityRole="button"
              accessibilityLabel={
                `Parada ${index + 1}, ${hora}, ${item.pdv?.nombre ?? 'sin nombre'}, ${e.txt.toLowerCase()}`
              }>
              <View style={s.filaSuperior}>
                <Text style={s.orden}>{index + 1}</Text>
                <Text style={s.hora}>{hora}</Text>
                <View style={[s.pastilla, { backgroundColor: e.fondo }]}>
                  <Text style={[s.pastillaTexto, { color: e.texto }]}>{e.txt}</Text>
                </View>
              </View>

              <Text style={s.tienda}>{item.pdv?.nombre}</Text>
              <Text style={s.direccion}>
                {item.pdv?.codigo}
                {item.pdv?.direccion ? ' · ' + item.pdv.direccion : ''}
                {item.pdv?.ciudad ? ' · ' + item.pdv.ciudad : ''}
              </Text>

              {item.tarea?.nombre && <Text style={s.tarea}>{item.tarea.nombre}</Text>}

              {v?.check_in && (
                <Text style={s.detalle}>
                  Entrada {new Date(v.check_in).toLocaleTimeString('es-MX',
                    { hour: '2-digit', minute: '2-digit' })}
                </Text>
              )}
            </Pressable>
          )
        }}
      />

      <Pressable
        style={s.salir}
        onPress={() => supabase.auth.signOut()}
        accessibilityRole="button"
        accessibilityLabel="Cerrar sesion">
        <Text style={s.salirTexto}>Cerrar sesión</Text>
      </Pressable>
    </SafeAreaView>
  )
}

function Dato({ valor, etiqueta }: { valor: number; etiqueta: string }) {
  return (
    <View style={s.dato}>
      <Text style={s.datoValor}>{valor}</Text>
      <Text style={s.datoEtiqueta}>{etiqueta}</Text>
    </View>
  )
}

const s = StyleSheet.create({
  pantalla: { flex: 1, backgroundColor: c.arena },
  centrado: { alignItems: 'center', justifyContent: 'center' },
  cargandoTexto: { fontFamily: f.texto, color: c.tinta2, fontSize: 14, marginTop: 14 },

  cabecera: { backgroundColor: c.azul, paddingHorizontal: 20, paddingTop: 14, paddingBottom: 18 },
  titulo: { fontFamily: f.display, color: c.blanco, fontSize: 24, letterSpacing: 0.5 },
  subtitulo: { fontFamily: f.texto, color: c.azulClaro, fontSize: 13.5, marginTop: 3 },

  lista: { padding: 14, paddingBottom: 30 },

  resumen: { flexDirection: 'row', gap: SEPARACION, marginBottom: 14 },
  dato: { flex: 1, backgroundColor: c.blanco, borderRadius: 11,
    borderWidth: 1, borderColor: c.borde, paddingVertical: 12, alignItems: 'center' },
  datoValor: { fontFamily: f.display, fontSize: 26, color: c.tinta, ...CIFRAS },
  datoEtiqueta: { fontFamily: f.displaySemi, fontSize: 10.5, color: c.tinta2,
    letterSpacing: 0.6, marginTop: 3 },

  tarjeta: { backgroundColor: c.blanco, borderRadius: 12, borderWidth: 1, borderColor: c.borde,
    borderLeftWidth: 5, padding: 14, marginBottom: SEPARACION + 2, minHeight: 96 },
  tarjetaPresionada: { opacity: 0.9 },
  filaSuperior: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  orden: { width: 26, height: 26, borderRadius: 7, backgroundColor: c.azulSuave,
    fontFamily: f.display, color: c.azul, fontSize: 13,
    textAlign: 'center', lineHeight: 26, ...CIFRAS },
  hora: { flex: 1, fontFamily: f.display, fontSize: 15, color: c.tinta, ...CIFRAS },
  pastilla: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 12 },
  pastillaTexto: { fontFamily: f.displaySemi, fontSize: 10, letterSpacing: 0.5 },

  tienda: { fontFamily: f.textoFuerte, fontSize: 17, color: c.tinta, lineHeight: 22 },
  direccion: { fontFamily: f.texto, fontSize: 13, color: c.tinta2, marginTop: 3, lineHeight: 18 },
  tarea: { fontFamily: f.displaySemi, fontSize: 12, color: c.naranjaTexto,
    marginTop: 7, letterSpacing: 0.3 },
  detalle: { fontFamily: f.texto, fontSize: 12.5, color: c.tinta2, marginTop: 6, ...CIFRAS },

  vacio: { padding: 36, alignItems: 'center' },
  vacioTitulo: { fontFamily: f.display, fontSize: 18, color: c.tinta, marginBottom: 8 },
  vacioTexto: { fontFamily: f.texto, fontSize: 14.5, color: c.tinta2,
    textAlign: 'center', lineHeight: 21 },

  aviso: { backgroundColor: c.errorSuave, borderWidth: 1, borderColor: c.errorBorde,
    borderRadius: 9, padding: 12, marginBottom: 12 },
  avisoTexto: { fontFamily: f.texto, color: c.errorTexto, fontSize: 14, lineHeight: 20 },

  salir: { minHeight: TOCABLE, alignItems: 'center', justifyContent: 'center',
    borderTopWidth: 1, borderTopColor: c.borde, backgroundColor: c.blanco },
  salirTexto: { fontFamily: f.textoMedio, color: c.azul, fontSize: 14 },
})
