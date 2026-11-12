import { useState } from 'react'
import {
  View, Text, TextInput, Pressable, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { supabase } from './supabase'
import { c, f, TOCABLE } from './tema'

export default function Login() {
  const [correo, setCorreo] = useState('')
  const [clave, setClave] = useState('')
  const [error, setError] = useState('')
  const [entrando, setEntrando] = useState(false)

  async function entrar() {
    setError('')
    if (!correo.includes('@')) {
      setError('Escribe tu correo completo, incluyendo la parte despues de la arroba.')
      return
    }
    if (clave.length < 6) {
      setError('La contraseña debe tener al menos 6 caracteres. Revisa que la hayas escrito completa.')
      return
    }
    setEntrando(true)
    const { error: err } = await supabase.auth.signInWithPassword({
      email: correo.trim(), password: clave,
    })
    setEntrando(false)
    if (err) {
      setError(err.message.toLowerCase().includes('invalid')
        ? 'Correo o contraseña incorrectos. Revisa los dos e intenta de nuevo.'
        : 'No se pudo entrar. Revisa tu conexion e intenta de nuevo.')
    }
  }

  return (
    <SafeAreaView style={s.pantalla} edges={['top', 'bottom', 'left', 'right']}>
      <KeyboardAvoidingView
        style={s.centro}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>

        <Text style={s.marca}>PLATAFORMA TM</Text>
        <Text style={s.sub}>Aplicación del promotor</Text>

        <View style={s.caja}>
          {error !== '' && (
            <View style={s.aviso} accessibilityLiveRegion="polite">
              <Text style={s.avisoTexto}>{error}</Text>
            </View>
          )}

          <Text style={s.etiqueta}>CORREO</Text>
          <TextInput
            style={s.campo}
            value={correo}
            onChangeText={setCorreo}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            autoComplete="email"
            textContentType="emailAddress"
            placeholder="nombre@empresa.com"
            placeholderTextColor={c.tinta2}
            accessibilityLabel="Correo"
          />

          <Text style={s.etiqueta}>CONTRASEÑA</Text>
          <TextInput
            style={s.campo}
            value={clave}
            onChangeText={setClave}
            secureTextEntry
            autoComplete="password"
            textContentType="password"
            accessibilityLabel="Contraseña"
          />

          <Pressable
            style={({ pressed }) => [s.boton, pressed && s.botonPresionado]}
            onPress={entrar}
            disabled={entrando}
            accessibilityRole="button"
            accessibilityLabel="Entrar"
            accessibilityState={{ busy: entrando, disabled: entrando }}>
            {entrando
              ? <ActivityIndicator color={c.blanco} />
              : <Text style={s.botonTexto}>ENTRAR</Text>}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  pantalla: { flex: 1, backgroundColor: c.arena },
  centro: { flex: 1, justifyContent: 'center', padding: 24 },

  marca: { fontFamily: f.display, fontSize: 30, color: c.azul,
    textAlign: 'center', letterSpacing: 1 },
  sub: { fontFamily: f.texto, fontSize: 15, color: c.tinta2,
    textAlign: 'center', marginTop: 6, marginBottom: 28 },

  caja: { backgroundColor: c.blanco, borderRadius: 14, padding: 22,
    borderWidth: 1, borderColor: c.borde },
  etiqueta: { fontFamily: f.displaySemi, fontSize: 11, color: c.tinta2,
    letterSpacing: 0.8, marginBottom: 6, marginTop: 4 },
  campo: { fontFamily: f.texto, borderWidth: 1, borderColor: c.borde,
    borderRadius: 9, paddingHorizontal: 14, minHeight: TOCABLE,
    fontSize: 16, color: c.tinta, backgroundColor: c.arena, marginBottom: 14 },
  boton: { backgroundColor: c.azul, borderRadius: 10, minHeight: 54,
    alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  botonPresionado: { opacity: 0.85 },
  botonTexto: { fontFamily: f.display, color: c.blanco, fontSize: 17, letterSpacing: 1 },

  aviso: { backgroundColor: c.errorSuave, borderWidth: 1, borderColor: c.errorBorde,
    borderRadius: 9, padding: 12, marginBottom: 14 },
  avisoTexto: { fontFamily: f.texto, color: c.errorTexto, fontSize: 14, lineHeight: 20 },
})
