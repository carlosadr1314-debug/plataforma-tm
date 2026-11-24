// Prueba del vigilante de radio. Corre con: npm run prueba
//
// Lo que importa: que no invente salidas (una falsa alarma le suena el
// telefono al promotor y le deja a la oficina un reporte que no pasó)
// y que no pierda las que si pasaron.

import { vigilar, soltar, revisar, alSalirse, sincronizarAlertas,
         alertasPendientes } from '../src/vigilanciaRadio.ts'
import { estado, reiniciar } from './dobles/supabase.mjs'

let ok = 0, mal = 0
function afirmar(que: string, cierto: boolean) {
  if (cierto) { ok++; console.log('  OK   ' + que) }
  else { mal++; console.log('  FALLA ' + que) }
}

// Una tienda en una latitud comoda. Un grado de longitud aqui son
// unos 105 km, asi que 0.001 son unos 105 m.
const TIENDA = { lat: 19.50, lng: -99.10, radio: 100 }
const punto = (dLng: number, precision = 10) => ({
  coords: { latitude: TIENDA.lat, longitude: TIENDA.lng + dLng, accuracy: precision },
})

let avisos: number[] = []

const esperar = () => new Promise(r => setTimeout(r, 10))

;(async () => {
  reiniciar()
  alSalirse(m => { avisos.push(m) })

  console.log('--- no se vigila lo que no se puede medir ---')
  vigilar({ itinerarioId: 'it-1', lat: null, lng: null, radio: 100 })
  afirmar('una tienda sin coordenadas no se vigila', revisar(punto(0)) === null)
  vigilar({ itinerarioId: 'it-1', lat: TIENDA.lat, lng: TIENDA.lng, radio: 0 })
  afirmar('ni una sin radio', revisar(punto(0)) === null)

  console.log('--- adentro no pasa nada ---')
  reiniciar(); avisos = []
  vigilar({ itinerarioId: 'it-1', ...TIENDA })
  revisar(punto(0))           // encima de la tienda
  revisar(punto(0.0005))      // unos 52 m
  await esperar()
  afirmar('no se avisa nada', avisos.length === 0)
  afirmar('no se guarda ninguna alerta', (await alertasPendientes()) === 0)

  console.log('--- alejarse de verdad si se registra ---')
  revisar(punto(0.003))       // unos 315 m
  await esperar()
  afirmar('se le avisa al promotor', avisos.length === 1)
  afirmar('y a la distancia a la que iba', avisos[0] > 250 && avisos[0] < 400)
  afirmar('queda una alerta guardada', (await alertasPendientes()) === 1)

  console.log('--- seguir afuera no genera otra ---')
  revisar(punto(0.004))
  revisar(punto(0.005))
  await esperar()
  afirmar('sigue siendo una sola', (await alertasPendientes()) === 1)
  afirmar('y no se le vuelve a avisar', avisos.length === 1)

  console.log('--- lo que se manda ---')
  let quedan = await sincronizarAlertas()
  afirmar('sale aunque siga abierta', estado.upserts.length === 1)
  const a = estado.upserts[0]
  afirmar('con el itinerario correcto', a.itinerario_id === 'it-1')
  afirmar('guarda hasta donde llego, no donde se fue', a.distancia_max > 450)
  afirmar('todavia sin hora de regreso', a.volvio_en === null)
  afirmar('y se queda pendiente hasta que vuelva', quedan === 1)

  console.log('--- volver cierra la alerta ---')
  revisar(punto(0.0002))      // de vuelta encima de la tienda
  await esperar()
  quedan = await sincronizarAlertas()
  afirmar('ya se cerro con su hora de regreso',
          estado.upserts[estado.upserts.length - 1].volvio_en !== null)
  afirmar('y ya no queda pendiente', quedan === 0)

  console.log('--- volver a salir es otra alerta ---')
  avisos = []
  revisar(punto(0.003))
  await esperar()
  afirmar('se avisa otra vez', avisos.length === 1)
  afirmar('y se guarda aparte', (await alertasPendientes()) === 1)

  console.log('--- cerrar la visita estando lejos ---')
  soltar()
  await esperar()
  await sincronizarAlertas()
  const ult = estado.upserts[estado.upserts.length - 1]
  afirmar('la salida se cierra con la hora de ahora, no se borra',
          ult.volvio_en !== null)

  console.log('--- sin red no se pierde ---')
  reiniciar(); avisos = []
  vigilar({ itinerarioId: 'it-2', ...TIENDA })
  revisar(punto(0.003))
  await esperar()
  estado.falla = { message: 'Network request failed' }
  quedan = await sincronizarAlertas()
  afirmar('se queda pendiente', quedan === 1)
  estado.falla = null
  revisar(punto(0))
  await esperar()
  quedan = await sincronizarAlertas()
  afirmar('y sale completa al volver la red',
          quedan === 0 && estado.upserts.length === 1 &&
          estado.upserts[0].volvio_en !== null)

  soltar()
  console.log(`\n${ok} pasaron, ${mal} fallaron`)
  if (mal) process.exitCode = 1
})()
