# Aplicacion del promotor

React Native con Expo. Se prueba en el telefono con la aplicacion
Expo Go, sin compilar ni instalar nada.

## Arranque

    npm install
    npx expo install @supabase/supabase-js @react-native-async-storage/async-storage \
      react-native-url-polyfill react-native-safe-area-context expo-font \
      @expo-google-fonts/archivo @expo-google-fonts/inter
    npx expo start

El archivo .env ya trae las credenciales del backoffice con el prefijo
EXPO_PUBLIC_. No se sube al repositorio.

Aparece un codigo QR en la terminal. En Android se escanea desde la
aplicacion Expo Go; en iPhone, desde la camara. El telefono y la
computadora deben estar en la misma red.

## Estructura

- `src/tema.ts` — direccion visual, paleta, tipografia y medidas
- `src/supabase.ts` — conexion, con la sesion guardada en el telefono
- `src/Login.tsx` — acceso
- `src/Itinerario.tsx` — ruta del dia

## Decisiones

- La consulta del itinerario no filtra por usuario. El aislamiento lo
  hacen las politicas de la base: cada promotor recibe solo su ruta.
- La fecha se toma del telefono, no del servidor, para que el dia que
  ve el promotor sea el suyo y no el de otra zona horaria.
- Si la tipografia no carga, la aplicacion arranca igual con la del
  sistema.

## Pendiente

Registro de entrada con ubicacion, captura de formularios, evidencia
fotografica y trabajo sin conexion.
