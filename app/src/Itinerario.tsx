import { useEffect, useState, useCallback } from 'react'
import {
  View, Text, FlatList, Pressable, StyleSheet,
  RefreshControl, ActivityIndicator,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { supabase } from './supabase'
import BarraJornada from './BarraJornada'
import Visita, { type Parada as ParadaVisita } from './Visita'
import {
  guardarRuta, rutaGuardada, pendientes, sincronizar, bajarFormulario,
  nombreGuardado, guardarNombre,
} from './sinSenal'
import { AppState } from 'react-native'
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
  const [abierta, setAbierta] = useState<string | null>(null)
  const [sinEnviar, setSinEnviar] = useState(0)
  const [deGuardado, setDeGuardado] = useState(false)

  // Lo que el promotor hizo sin señal se encima a lo que venga: en su
  // pantalla la visita ya esta hecha, aunque al servidor todavia no
  // haya llegado.
  const pintar = useCallback(async (ruta: any[], guardada: boolean) => {
    const pend = await pendientes()
    setSinEnviar(Object.keys(pend).length)
    setParadas(ruta.map(p => {
      const extra = pend[p.id]
      if (!extra) return p
      return { ...p, visita: { ...(unaVisita(p.visita) ?? {}), ...extra } }
    }))
    setDeGuardado(guardada)
  }, [])

  const cargar = useCallback(async (primera = false) => {
    setError('')
    const hoy = hoyLocal()

    // Abrir la aplicacion no deberia costar un viaje al servidor antes
    // de ver la primera linea. Si la ruta de hoy ya se bajo, se pinta
    // de inmediato y la red nada mas la refresca por detras.
    if (primera) {
      const n = await nombreGuardado()
      if (n) setNombre(n)
      const g = await rutaGuardada(hoy)
      if (g?.paradas) {
        await pintar(g.paradas as any[], false)
        setCargando(false)
      }
    }

    // Lo pendiente sale solo. Antes se esperaba a que terminara para
    // enseñar la ruta, y sin señal eso eran doce segundos de rueda
    // girando por algo que al promotor no le urge ver.
    void sincronizar().then(q => { if (q === 0) setSinEnviar(0) }).catch(() => {})

    // getSession lee la sesion del telefono. getUser la iba a preguntar
    // al servidor cada vez, para sacar un id que ya estaba aqui.
    const { data: s } = await supabase.auth.getSession()
    const uid = s.session?.user?.id ?? null

    // El nombre y la ruta no dependen uno del otro: van juntos, no uno
    // tras otro.
    const [perfil, resp] = await Promise.all([
      uid
        ? supabase.from('usuario').select('nombre').eq('id', uid).maybeSingle()
        : Promise.resolve({ data: null as { nombre: string } | null }),
      // El aislamiento lo hace la base: esta consulta no filtra por
      // usuario, las politicas de seguridad solo devuelven su ruta.
      supabase.from('itinerario')
        .select(`id,hora_estimada,cliente_id,
                 pdv:pdv_id(codigo,nombre,direccion,ciudad,lat,lng,radio_checkin),
                 tarea:tarea_id(nombre,formulario_id),
                 visita(id,estado,check_in,check_out,distancia_pdv,motivo_no_visita)`)
        .eq('fecha_programada', hoy)
        .order('hora_estimada'),
    ])

    if (perfil.data?.nombre) {
      setNombre(perfil.data.nombre)
      void guardarNombre(perfil.data.nombre)
    }

    const { data, error: err } = resp
    if (err || !data) {
      // Sin red: se trabaja con la ruta que quedo guardada. Si tampoco
      // hay guardada, ahi si no hay nada que mostrar.
      const g = await rutaGuardada(hoy)
      if (g?.paradas) {
        await pintar(g.paradas as any[], true)
      } else {
        setParadas([])
        setDeGuardado(false)
        setError('No se pudo cargar tu ruta y no hay una guardada en el teléfono. ' +
                 'Busca señal y desliza hacia abajo para reintentar.')
      }
      return
    }

    const ruta = data as any[]
    guardarRuta(hoy, ruta)
    await pintar(ruta, false)

    // Los formularios del dia se bajan aqui, de mañana y con señal.
    // Adentro de la tienda ya no hay red, y un formulario que no se
    // alcanzo a bajar deja al promotor parado sin poder capturar.
    const porBajar = new Map<string, string>()
    ruta.forEach((p: any) => {
      if (p.tarea?.formulario_id && p.cliente_id)
        porBajar.set(p.tarea.formulario_id, p.cliente_id)
    })
    porBajar.forEach((cli, form) => { void bajarFormulario(form, cli).catch(() => {}) })
  }, [pintar])

  useEffect(() => { cargar(true).finally(() => setCargando(false)) }, [cargar])

  // Volver a la aplicacion es la mejor señal de que puede haber red.
  useEffect(() => {
    const sub = AppState.addEventListener('change', e => { if (e === 'active') cargar() })
    return () => sub.remove()
  }, [cargar])

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

  // La visita se monta encima de la ruta: una pantalla a la vez, que es
  // lo que se puede manejar con una mano en el pasillo de una tienda.
  const paradaAbierta = paradas.find(p => p.id === abierta)
  if (paradaAbierta) {
    return (
      <Visita
        parada={paradaAbierta as unknown as ParadaVisita}
        onCerrar={() => setAbierta(null)}
        onCambio={volver => { cargar(); if (volver) setAbierta(null) }}
      />
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
            {/* La jornada va antes que la ruta: es lo primero que hace
                en la manana y lo ultimo en la tarde. */}
            <BarraJornada />

            {(sinEnviar > 0 || deGuardado) && (
              <View style={s.sinRed} accessibilityLiveRegion="polite">
                <Text style={s.sinRedTexto}>
                  {deGuardado && 'Sin señal: ésta es la ruta que quedó guardada en el teléfono. '}
                  {sinEnviar > 0 && (sinEnviar === 1
                    ? 'Tienes 1 visita sin enviar; sale sola en cuanto haya señal.'
                    : `Tienes ${sinEnviar} visitas sin enviar; salen solas en cuanto haya señal.`)}
                </Text>
              </View>
            )}

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
              onPress={() => setAbierta(item.id)}
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

  // Ni rojo ni alarmante: no es un error, es el estado normal de
  // trabajar adentro de una tienda. Solo tiene que verse.
  sinRed: { backgroundColor: c.naranjaSuave, borderWidth: 1, borderColor: '#F0C4AC',
    borderRadius: 9, padding: 11, marginBottom: 12 },
  sinRedTexto: { fontFamily: f.texto, fontSize: 13, color: c.naranjaTexto,
    lineHeight: 18.5 },

  aviso: { backgroundColor: c.errorSuave, borderWidth: 1, borderColor: c.errorBorde,
    borderRadius: 9, padding: 12, marginBottom: 12 },
  avisoTexto: { fontFamily: f.texto, color: c.errorTexto, fontSize: 14, lineHeight: 20 },

  salir: { minHeight: TOCABLE, alignItems: 'center', justifyContent: 'center',
    borderTopWidth: 1, borderTopColor: c.borde, backgroundColor: c.blanco },
  salirTexto: { fontFamily: f.textoMedio, color: c.azul, fontSize: 14 },
})
