# Compilar la aplicación del promotor

Expo Go sirve para probar la lógica, pero no para trabajar de verdad.
Tres cosas no funcionan ahí y no se pueden arreglar con código:

- **Los avisos.** Se programan, pero Expo Go no los entrega de forma
  confiable en iOS con la aplicación cerrada. Un promotor no va a
  recibir su recordatorio de las 7 de la mañana.
- **La ubicación en segundo plano.** Hoy el rastreo solo corre con la
  aplicación abierta. Con el teléfono en la bolsa deja de reportar.
- **La velocidad.** Buena parte de la lentitud entre pantallas es el
  *bundle* de desarrollo bajando por la red, no la aplicación.

## Qué hay que hacer, una sola vez

```bash
cd ~/Documents/plataforma-tm/app

# 1. La herramienta
npm install -g eas-cli

# 2. Entrar con tu cuenta de Expo (la crea gratis en expo.dev)
eas login

# 3. Enlazar este proyecto. Esto agrega el projectId al app.json.
#    No lo escribas a mano: lo genera Expo y tiene que ser el suyo.
eas init
```

## Las variables de Supabase: el paso que se olvida

`app/.env` está en `.gitignore`, y con razón. Pero eso significa que
**no se sube a los servidores de Expo**: ahí se compila a partir de lo
que está en git. Sin esas dos variables la compilación termina bien y
el APK abre en una pantalla muerta, porque no sabe a qué Supabase
hablarle.

Se guardan una vez en EAS, que las inyecta al compilar. Esto las lee
de tu propio `.env`, así no hay que copiar y pegar nada:

```bash
cd ~/Documents/plataforma-tm/app
set -a; source .env; set +a

for AMBIENTE in development preview production; do
  eas env:set --name EXPO_PUBLIC_SUPABASE_URL \
    --value "$EXPO_PUBLIC_SUPABASE_URL" \
    --environment $AMBIENTE --visibility plaintext
  eas env:set --name EXPO_PUBLIC_SUPABASE_ANON_KEY \
    --value "$EXPO_PUBLIC_SUPABASE_ANON_KEY" \
    --environment $AMBIENTE --visibility plaintext
done
```

`plaintext` es lo correcto aquí: la llave anónima viaja dentro de cada
APK de todos modos, no es un secreto. Lo que la protege es RLS, no el
esconderla. Lo que **no** debe subirse nunca así es la llave de
servicio (`service_role`), que la aplicación no usa.

Cada perfil de `eas.json` ya dice de qué ambiente toma sus variables:
`desarrollo` → development, `prueba` → preview, `produccion` →
production.

## Las tres variantes

`eas.json` ya trae tres perfiles, cada uno para un momento distinto:

| Perfil | Para qué | Cómo se instala |
|---|---|---|
| `desarrollo` | Reemplaza a Expo Go. Trae el código nativo de verdad pero sigue recargando al guardar. | APK, se instala directo |
| `prueba` | Para que un promotor la use un día completo en campo. | APK, se instala directo |
| `produccion` | Para subir a Google Play. | AAB, se sube a la tienda |

```bash
# Para repartir: se instala y funciona sola, sin la laptop encendida.
eas build --profile prueba --platform android
```

Tarda entre 10 y 25 minutos y corre en los servidores de Expo; puedes
cerrar la terminal. Al final te da un enlace para descargar el APK en
el teléfono.

El perfil `prueba` trae el código empaquetado adentro: se instala y
funciona, sin servidor. Es el que se le pasa a un promotor.

El perfil `desarrollo` es distinto: reemplaza a Expo Go para seguir
programando con módulos nativos, y necesita el servidor prendido.

```bash
eas build --profile desarrollo --platform android   # una vez
npx expo start --dev-client                         # cada sesión
```

## El identificador del paquete

`mx.plataformatm.promotor`, ya puesto en `app.json`. A nombre del
producto y no de una empresa: sobrevive a un cambio de nombre
comercial o a que la plataforma cambie de dueño.

Es permanente **a partir de que se publique en Google Play**: desde
ahí no se puede cambiar sin publicar otra aplicación distinta.
Mientras solo se repartan APKs, cambiarlo no cuesta nada más que
reinstalar.

## La ubicación en segundo plano va en la SEGUNDA

Pide el permiso `ACCESS_BACKGROUND_LOCATION`, que dispara una revisión
manual de Google Play. Pero eso **solo aplica al subir a la tienda**:
repartiendo APKs no hay revisión ni trámite.

Se deja para la segunda compilación por otra razón: si la primera
compilación nativa trae ademas una función nueva y algo no funciona,
no hay forma de saber si fallo la compilación o la función. Primero
una compilación conocida y funcionando; después la función, con un
solo cambio que culpar.

## iOS

Compilar para iPhone necesita cuenta de Apple Developer, que cuesta
99 USD al año. Para Android no hace falta nada de eso: Google Play
cobra 25 USD una sola vez, y para repartir APKs de prueba, nada.
