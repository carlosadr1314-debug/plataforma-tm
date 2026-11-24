// Prueba de la regla del check-in. Corre con: npm run prueba
import { zonaDeCheckin, sigueFuera, metrosEntre } from '../src/radio.ts'

let ok = 0, mal = 0
function afirmar(que: string, cierto: boolean) {
  if (cierto) { ok++; console.log('  OK   ' + que) }
  else { mal++; console.log('  FALLA ' + que) }
}

console.log('--- la zona del check-in (radio 150, tolerancia 20) ---')
const R = 150
const z = (m: number, g: number) => zonaDeCheckin(m, g, R)

afirmar('parado en la tienda, GPS bueno',            z(34, 8) === 'dentro')
afirmar('en el estacionamiento, dentro del radio',   z(140, 10) === 'dentro')
afirmar('apenas afuera: avisa y deja',               z(165, 5) === 'cerca')
afirmar('justo en el limite: todavia deja',          z(170, 0) === 'cerca')
afirmar('un metro mas: bloquea',                     z(171, 0) === 'bloqueado')
afirmar('media cuadra: bloquea',                     z(400, 15) === 'bloqueado')
afirmar('desde su casa a 1.6 km: bloquea',           z(1633, 20) === 'bloqueado')

console.log('--- el margen del GPS da el beneficio de la duda ---')
afirmar('300 m con margen de 250 = adentro en el mejor caso', z(300, 250) === 'dentro')
afirmar('bajo techo, 200 ±60, sigue pasando',        z(200, 60) === 'dentro')
afirmar('pero 900 ±15 no se salva',                  z(900, 15) === 'bloqueado')
afirmar('un margen absurdo no vuelve negativa la distancia', z(50, 9999) === 'dentro')
afirmar('un margen negativo no regala metros',       z(400, -500) === 'bloqueado')

console.log('--- una tienda chica aprieta sola ---')
afirmar('radio 40: a 55 m con GPS bueno, avisa',     zonaDeCheckin(55, 5, 40) === 'cerca')
afirmar('radio 40: a 120 m con GPS bueno, bloquea',  zonaDeCheckin(120, 5, 40) === 'bloqueado')

console.log('--- salirse del radio con la visita en curso ---')
// radio 100, margen de GPS 10, colchon 50: para declararlo fuera
// tiene que estar a mas de 160.
afirmar('adentro no es salirse', !sigueFuera(40, 10, 100, false))
afirmar('justo en el borde tampoco', !sigueFuera(100, 10, 100, false))
afirmar('pasado el radio pero dentro del colchon, no',
        !sigueFuera(150, 10, 100, false))
afirmar('lejos de verdad, si', sigueFuera(200, 10, 100, false))
afirmar('con el GPS impreciso se le da el beneficio de la duda',
        !sigueFuera(200, 60, 100, false))

// Y la histeresis: ya declarado fuera, para volver basta con poder
// estar dentro. Sin esto, parado en el borde generaria una alerta por
// minuto.
afirmar('ya fuera, sigue fuera a 150', sigueFuera(150, 10, 100, true))
afirmar('ya fuera, vuelve al entrar al radio', !sigueFuera(100, 10, 100, true))
afirmar('el colchon solo cuenta para salir, no para volver',
        !sigueFuera(105, 10, 100, true) && !sigueFuera(150, 10, 100, false))

console.log('--- distancia entre dos puntos ---')
afirmar('el mismo punto da cero', metrosEntre(19.5, -99.1, 19.5, -99.1) === 0)
// Un grado de latitud son unos 111 km; una centesima, unos 1.1 km.
const d = metrosEntre(19.50, -99.10, 19.51, -99.10)
afirmar('una centesima de latitud ronda los 1110 m', d > 1090 && d < 1130)

console.log(`\n${ok} pasaron, ${mal} fallaron`)
if (mal) process.exitCode = 1
