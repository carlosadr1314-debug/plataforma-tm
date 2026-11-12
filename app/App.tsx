import { useEffect, useState } from 'react'
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { StatusBar } from 'expo-status-bar'
import { useFonts } from 'expo-font'
import { Archivo_600SemiBold, Archivo_700Bold } from '@expo-google-fonts/archivo'
import { Inter_400Regular, Inter_500Medium, Inter_700Bold } from '@expo-google-fonts/inter'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './src/supabase'
import Login from './src/Login'
import Itinerario from './src/Itinerario'
import { c } from './src/tema'

export default function App() {
  const [sesion, setSesion] = useState<Session | null>(null)
  const [revisando, setRevisando] = useState(true)

  const [fuentesListas, errorFuentes] = useFonts({
    Archivo_600SemiBold, Archivo_700Bold,
    Inter_400Regular, Inter_500Medium, Inter_700Bold,
  })

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSesion(data.session)
      setRevisando(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSesion(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  // Si la tipografia no carga, la aplicacion sigue siendo usable con la
  // del sistema: no se bloquea al promotor por un asunto estetico.
  const listo = (fuentesListas || errorFuentes != null) && !revisando

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      {listo
        ? (sesion ? <Itinerario /> : <Login />)
        : (
          <View style={s.centro}>
            <ActivityIndicator color={c.azul} size="large" />
            <Text style={s.texto}>Abriendo…</Text>
          </View>
        )}
    </SafeAreaProvider>
  )
}

const s = StyleSheet.create({
  centro: { flex: 1, alignItems: 'center', justifyContent: 'center',
    backgroundColor: c.arena, gap: 14 },
  texto: { color: c.tinta2, fontSize: 14 },
})
