import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  View, Text, TextInput, Pressable, StyleSheet, ScrollView,
  ActivityIndicator,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase } from './supabase'
import Teclado from './Teclado'
import { c, f, CIFRAS, TOCABLE } from './tema'

// =====================================================================
// Acceso del promotor
//
// El promotor no entra con correo: entra con el codigo de su empresa, su
// codigo de empleado y un NIP de ocho digitos. El correo existe —la
// cuenta de Supabase necesita uno— pero se arma solo:
//
//     <codigo de empleado>@<codigo de empresa>.promotor.local
//
// y nadie lo escribe nunca. Asi el codigo de empleado puede repetirse
// entre empresas sin chocar, que es justo lo que pasa en la vida real.
//
// Tres datos son muchos para una pantalla de telefono estando de pie en
// una tienda, asi que se piden en tres momentos distintos y cada uno se
// queda guardado:
//
//   · empresa  — una sola vez, al instalar
//   · empleado — una sola vez, la primera manana
//   · NIP      — lo unico que se teclea de ahi en adelante
//
// Con un solo campo en pantalla el teclado cabe completo hasta en un
// telefono de 640 puntos de alto, que es el piso real del parque.
// =====================================================================

const LARGO_NIP = 8
const MIN_CODIGO = 4
const MAX_CODIGO = 10

const LLAVE_EMPRESA = 'tm.empresa'
const LLAVE_CODIGO = 'tm.codigo'

// Lo que se teclea en "empresa" se normaliza aqui y no en la validacion:
// el promotor puede escribirlo con mayusculas o con un espacio colado.
const limpiarEmpresa = (t: string) =>
  t.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 30)

type Paso = 'empresa' | 'codigo' | 'nip'

export default function Login() {
  const [paso, setPaso] = useState<Paso>('nip')
  const [abriendo, setAbriendo] = useState(true)

  const [empresa, setEmpresa] = useState('')
  const [empresaEscrita, setEmpresaEscrita] = useState('')
  const [codigo, setCodigo] = useState('')
  const [nip, setNip] = useState('')

  const [error, setError] = useState('')
  const [entrando, setEntrando] = useState(false)

  // Con que NIP se intento la ultima vez, para que el envio automatico
  // no se dispare dos veces con lo mismo.
  const intentado = useRef('')

  useEffect(() => {
    (async () => {
      let emp = '', cod = ''
      try {
        const guardado = await AsyncStorage.multiGet([LLAVE_EMPRESA, LLAVE_CODIGO])
        emp = guardado[0][1] ?? ''
        cod = guardado[1][1] ?? ''
      } catch {
        // Si el almacenamiento falla se pregunta todo otra vez: molesta,
        // pero no deja a nadie fuera.
      }
      setEmpresa(emp)
      setCodigo(cod)
      setPaso(!emp ? 'empresa' : !cod ? 'codigo' : 'nip')
      setAbriendo(false)
    })()
  }, [])

  async function entrar(clave: string) {
    setEntrando(true)
    const { error: err } = await supabase.auth.signInWithPassword({
      email: `${codigo}@${empresa}.promotor.local`,
      password: clave,
    })
    setEntrando(false)
    if (!err) return

    // Supabase responde lo mismo si la cuenta no existe que si el NIP
    // esta mal, y aqui el correo lleva dentro los tres datos. No se
    // puede saber cual fallo, asi que se nombran los tres.
    setError(err.message.toLowerCase().includes('invalid')
      ? 'No se pudo entrar. Revisa tu NIP, y que tu código de empleado ' +
        `(${codigo}) y el de tu empresa (${empresa}) sean los correctos.`
      : 'No se pudo entrar. Revisa que tengas señal e inténtalo otra vez.')
  }

  // El NIP se manda solo al llegar a los ocho digitos, como la pantalla
  // de bloqueo del telefono. Si falla, los digitos se quedan puestos: se
  // corrige el ultimo con BORRAR y vuelve a mandarse al completarlo.
  useEffect(() => {
    if (paso !== 'nip' || entrando) return
    if (nip.length !== LARGO_NIP || intentado.current === nip) return
    intentado.current = nip
    entrar(nip)
  }, [nip, paso, entrando])

  function escribir(d: string) {
    setError('')
    if (paso === 'codigo') setCodigo(v => (v.length >= MAX_CODIGO ? v : v + d))
    else setNip(v => (v.length >= LARGO_NIP ? v : v + d))
  }

  function borrar() {
    setError('')
    if (paso === 'codigo') setCodigo(v => v.slice(0, -1))
    else setNip(v => v.slice(0, -1))
  }

  function limpiar() {
    setError('')
    if (paso === 'codigo') setCodigo('')
    else setNip('')
  }

  function irAEmpresa() {
    setEmpresaEscrita(empresa)
    setError('')
    setPaso('empresa')
  }

  function guardarEmpresa() {
    const limpia = limpiarEmpresa(empresaEscrita)
    if (limpia.length < 3) {
      setError('El código de la empresa tiene al menos tres letras. ' +
        'Si no lo sabes, pídeselo a tu supervisor.')
      return
    }
    setError('')
    setEmpresa(limpia)
    setPaso(codigo.length >= MIN_CODIGO ? 'nip' : 'codigo')
    AsyncStorage.setItem(LLAVE_EMPRESA, limpia).catch(() => {})
  }

  function guardarCodigo() {
    if (codigo.length < MIN_CODIGO) {
      setError(`Tu código de empleado tiene al menos ${MIN_CODIGO} dígitos.`)
      return
    }
    setError('')
    setNip('')
    intentado.current = ''
    setPaso('nip')
    AsyncStorage.setItem(LLAVE_CODIGO, codigo).catch(() => {})
  }

  if (abriendo) {
    return (
      <SafeAreaView style={[s.pantalla, s.centrado]}>
        <ActivityIndicator color={c.azul} size="large" />
      </SafeAreaView>
    )
  }

  // ---------------------------------------------------------------
  // De que empresa es este telefono. Se pregunta al instalar y despues
  // solo si lo cambian a mano.
  // ---------------------------------------------------------------
  if (paso === 'empresa') {
    return (
      <SafeAreaView style={s.pantalla} edges={['top', 'bottom', 'left', 'right']}>
        <ScrollView contentContainerStyle={s.scrollCentrado}
                    keyboardShouldPersistTaps="handled">
          <Text style={s.marca}>PLATAFORMA TM</Text>
          <Text style={s.sub}>Aplicación del promotor</Text>

          <View style={s.caja}>
            <Text style={s.titulo}>¿De qué empresa eres?</Text>
            <Text style={s.ayuda}>
              Se escribe una sola vez. Es el código corto de tu empresa, no el
              nombre completo.
            </Text>

            {error !== '' && <Aviso texto={error} />}

            <Text style={s.etiqueta}>CÓDIGO DE EMPRESA</Text>
            <TextInput
              style={s.campoTexto}
              value={empresaEscrita}
              onChangeText={t => setEmpresaEscrita(limpiarEmpresa(t))}
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
              maxLength={30}
              placeholder="ejemplo"
              placeholderTextColor={c.tinta2}
              onSubmitEditing={guardarEmpresa}
              returnKeyType="done"
              accessibilityLabel="Código de empresa"
            />

            <Boton texto="CONTINUAR" onPress={guardarEmpresa} />

            {empresa !== '' && (
              <Enlace texto="Cancelar"
                      onPress={() => { setError(''); setPaso('nip') }} />
            )}
          </View>
        </ScrollView>
      </SafeAreaView>
    )
  }

  // ---------------------------------------------------------------
  // Codigo de empleado. Tambien una sola vez.
  // ---------------------------------------------------------------
  if (paso === 'codigo') {
    return (
      <Marco
        empresa={empresa} onCambiarEmpresa={irAEmpresa} error={error}
        titulo="Tu código de empleado"
        ayuda="Se guarda en este teléfono y no vuelve a pedirse."
        campo={
          <Casilla etiqueta="CÓDIGO DE EMPLEADO"
                   lectura={codigo === '' ? 'vacío' : codigo.split('').join(' ')}>
            <Text style={[s.valor, codigo === '' && s.valorVacio]}>
              {codigo === '' ? '––––' : codigo}
            </Text>
          </Casilla>
        }
        onDigito={escribir} onBorrar={borrar} onLimpiar={limpiar}
        pie={
          <Boton texto="SIGUIENTE" onPress={guardarCodigo}
                 apagado={codigo.length < MIN_CODIGO} />
        }
      />
    )
  }

  // ---------------------------------------------------------------
  // NIP. Lo unico de todos los dias.
  // ---------------------------------------------------------------
  return (
    <Marco
      empresa={empresa} onCambiarEmpresa={irAEmpresa} error={error}
      titulo="Tu NIP"
      codigo={codigo}
      onCambiarCodigo={() => {
        setError(''); setNip(''); intentado.current = ''; setPaso('codigo')
      }}
      campo={
        <Casilla etiqueta="NIP" lectura={`${nip.length} de ${LARGO_NIP} dígitos`}>
          <View style={s.puntos}>
            {Array.from({ length: LARGO_NIP }).map((_, i) => (
              <View key={i} style={[s.punto, i < nip.length && s.puntoLleno]} />
            ))}
          </View>
        </Casilla>
      }
      onDigito={escribir} onBorrar={borrar} onLimpiar={limpiar}
      ocupado={entrando}
      pie={
        entrando
          ? (
            <View style={s.verificando} accessibilityLiveRegion="polite">
              <ActivityIndicator color={c.azul} />
              <Text style={s.verificandoTexto}>Entrando…</Text>
            </View>
          )
          : (
            <Text style={s.nota}>
              Si la empresa o tu número no son los tuyos, tócalos arriba para
              cambiarlos. ¿Olvidaste tu NIP? Pídele a tu supervisor que te
              genere uno nuevo.
            </Text>
          )
      }
    />
  )
}

// ---------------------------------------------------------------------
// El armazon de las dos pantallas con teclado: cabecera, un solo campo,
// teclado pegado abajo y lo que toque debajo.
// ---------------------------------------------------------------------

function Marco({
  empresa, onCambiarEmpresa, codigo, onCambiarCodigo, error, titulo, ayuda,
  campo, onDigito, onBorrar, onLimpiar, ocupado, pie,
}: {
  empresa: string
  onCambiarEmpresa: () => void
  codigo?: string
  onCambiarCodigo?: () => void
  error: string
  titulo: string
  ayuda?: string
  campo: ReactNode
  onDigito: (d: string) => void
  onBorrar: () => void
  onLimpiar: () => void
  ocupado?: boolean
  pie: ReactNode
}) {
  return (
    <SafeAreaView style={s.pantalla} edges={['top', 'bottom', 'left', 'right']}>
      <ScrollView contentContainerStyle={s.scroll}>

        {/* Sin marca en estas pantallas: el promotor ya sabe en que
            aplicacion esta y cada renglon que se ahorra es un renglon
            que gana el teclado en un telefono de 640 de alto. */}
        <Text style={s.titulo}>{titulo}</Text>

        {/* Lo que ya esta resuelto vive aqui: se ve de reojo y se corrige
            de un toque, sin ocupar un campo en la pantalla. */}
        <View style={s.fichas}>
          <Ficha etiqueta="EMPRESA" valor={empresa} onPress={onCambiarEmpresa} />
          {onCambiarCodigo && codigo != null && (
            <Ficha etiqueta="EMPLEADO" valor={codigo} onPress={onCambiarCodigo} />
          )}
        </View>

        {ayuda != null && <Text style={s.ayudaCorta}>{ayuda}</Text>}

        {error !== '' && <Aviso texto={error} />}

        {campo}

        {/* Empuja el teclado al fondo: el pulgar llega mejor abajo. En
            pantallas chicas se encoge a nada y no estorba. */}
        <View style={s.separador} />

        <Teclado onDigito={onDigito} onBorrar={onBorrar} onLimpiar={onLimpiar}
                 deshabilitado={ocupado} />

        {pie}
      </ScrollView>
    </SafeAreaView>
  )
}

function Ficha({ etiqueta, valor, onPress }: {
  etiqueta: string; valor: string; onPress: () => void
}) {
  return (
    <Pressable style={s.chip} onPress={onPress}
               accessibilityRole="button"
               accessibilityLabel={`${etiqueta}: ${valor}. Tocar para cambiarlo`}>
      <Text style={s.chipEtiqueta}>{etiqueta}</Text>
      <Text style={s.chipValor}>{valor}</Text>
    </Pressable>
  )
}

function Casilla({ etiqueta, lectura, children }: {
  etiqueta: string; lectura: string; children: ReactNode
}) {
  return (
    <View style={s.casilla} accessible accessibilityLabel={`${etiqueta}: ${lectura}`}>
      <Text style={[s.etiqueta, s.etiquetaCasilla]}>{etiqueta}</Text>
      {children}
    </View>
  )
}

function Aviso({ texto }: { texto: string }) {
  return (
    <View style={s.aviso} accessibilityLiveRegion="polite">
      <Text style={s.avisoTexto}>{texto}</Text>
    </View>
  )
}

function Boton({ texto, onPress, ocupado, apagado }: {
  texto: string; onPress: () => void; ocupado?: boolean; apagado?: boolean
}) {
  return (
    <Pressable
      style={({ pressed }) => [
        s.boton,
        apagado && s.botonApagado,
        pressed && !apagado && !ocupado && s.botonPresionado,
      ]}
      onPress={onPress}
      disabled={ocupado}
      accessibilityRole="button"
      accessibilityLabel={texto}
      accessibilityState={{ busy: !!ocupado, disabled: !!apagado }}>
      {ocupado
        ? <ActivityIndicator color={c.blanco} />
        : <Text style={s.botonTexto}>{texto}</Text>}
    </Pressable>
  )
}

function Enlace({ texto, onPress }: { texto: string; onPress: () => void }) {
  return (
    <Pressable style={s.enlace} onPress={onPress}
               accessibilityRole="button" accessibilityLabel={texto}>
      <Text style={s.enlaceTexto}>{texto}</Text>
    </Pressable>
  )
}

// ---------------------------------------------------------------------

const s = StyleSheet.create({
  pantalla: { flex: 1, backgroundColor: c.arena },
  centrado: { alignItems: 'center', justifyContent: 'center' },
  scroll: { flexGrow: 1, padding: 20, paddingBottom: 24, gap: 10 },
  scrollCentrado: { flexGrow: 1, justifyContent: 'center', padding: 24 },

  marca: { fontFamily: f.display, fontSize: 30, color: c.azul,
    textAlign: 'center', letterSpacing: 1 },
  sub: { fontFamily: f.texto, fontSize: 15, color: c.tinta2,
    textAlign: 'center', marginTop: 6, marginBottom: 28 },

  fichas: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },

  // La empresa no es un campo: es el dato de fondo. Se ve, se puede
  // cambiar, pero no compite con lo que hay que teclear.
  chip: { minHeight: 56, justifyContent: 'center', paddingHorizontal: 13,
    paddingVertical: 7, borderRadius: 9, backgroundColor: c.azulSuave,
    borderWidth: 1, borderColor: c.azulClaro },
  chipEtiqueta: { fontFamily: f.displaySemi, fontSize: 9.5, color: c.azul,
    letterSpacing: 0.8, marginBottom: 1 },
  chipValor: { fontFamily: f.textoFuerte, fontSize: 15, color: c.azul,
    ...CIFRAS },

  caja: { backgroundColor: c.blanco, borderRadius: 14, padding: 22,
    borderWidth: 1, borderColor: c.borde },
  titulo: { fontFamily: f.display, fontSize: 23, color: c.tinta, marginTop: 2 },
  ayuda: { fontFamily: f.texto, fontSize: 14, color: c.tinta2,
    lineHeight: 20, marginTop: 6, marginBottom: 16 },
  ayudaCorta: { fontFamily: f.texto, fontSize: 13.5, color: c.tinta2,
    lineHeight: 19 },

  etiqueta: { fontFamily: f.displaySemi, fontSize: 11, color: c.tinta2,
    letterSpacing: 0.8, marginBottom: 6 },
  etiquetaCasilla: { marginBottom: 4 },

  campoTexto: { fontFamily: f.texto, borderWidth: 1, borderColor: c.borde,
    borderRadius: 9, paddingHorizontal: 14, minHeight: TOCABLE,
    fontSize: 16, color: c.tinta, backgroundColor: c.arena, marginBottom: 16 },

  // Hay un solo campo en pantalla, asi que no hace falta marcar cual
  // esta activo: el teclado solo puede escribir en este.
  casilla: { backgroundColor: c.blanco, borderRadius: 11, borderWidth: 1,
    borderColor: c.borde, paddingHorizontal: 14, paddingTop: 10,
    paddingBottom: 12, minHeight: 70, justifyContent: 'center' },

  valor: { fontFamily: f.display, fontSize: 28, color: c.tinta,
    letterSpacing: 3, ...CIFRAS },
  valorVacio: { color: c.neutro },

  puntos: { flexDirection: 'row', gap: 10, paddingVertical: 7 },
  punto: { width: 15, height: 15, borderRadius: 8,
    borderWidth: 1.5, borderColor: c.neutro, backgroundColor: 'transparent' },
  puntoLleno: { backgroundColor: c.azul, borderColor: c.azul },

  separador: { flex: 1, minHeight: 4 },

  boton: { backgroundColor: c.azul, borderRadius: 10, minHeight: 56,
    alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  botonPresionado: { opacity: 0.85 },
  // Apagado, no escondido: se ve que ahi esta y que falta algo.
  botonApagado: { backgroundColor: c.neutroTexto },
  botonTexto: { fontFamily: f.display, color: c.blanco, fontSize: 17,
    letterSpacing: 1 },

  enlace: { minHeight: TOCABLE, justifyContent: 'center' },
  enlaceTexto: { fontFamily: f.textoMedio, fontSize: 14, color: c.azul,
    textDecorationLine: 'underline' },

  verificando: { flexDirection: 'row', alignItems: 'center',
    justifyContent: 'center', gap: 10, minHeight: 44, marginTop: 4 },
  verificandoTexto: { fontFamily: f.textoMedio, fontSize: 15, color: c.azul },

  nota: { fontFamily: f.texto, fontSize: 12.5, color: c.tinta2,
    lineHeight: 18, textAlign: 'center', marginTop: 4 },

  aviso: { backgroundColor: c.errorSuave, borderWidth: 1, borderColor: c.errorBorde,
    borderRadius: 9, padding: 12 },
  avisoTexto: { fontFamily: f.texto, color: c.errorTexto, fontSize: 14,
    lineHeight: 20 },
})
