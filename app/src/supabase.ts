import 'react-native-url-polyfill/auto'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { createClient } from '@supabase/supabase-js'

const url = process.env.EXPO_PUBLIC_SUPABASE_URL as string
const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY as string

if (!url || !key) {
  throw new Error(
    'Faltan EXPO_PUBLIC_SUPABASE_URL o EXPO_PUBLIC_SUPABASE_ANON_KEY. ' +
    'Copia .env.example como .env y llena los valores.'
  )
}

export const supabase = createClient(url, key, {
  auth: {
    // La sesion vive en el telefono: el promotor no vuelve a escribir
    // su contrasena cada manana.
    storage: AsyncStorage,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
})
