// Prueba de las cuentas de reloj del horario y de que avisos tocan.
// Corre con: npm run prueba

import { avisosAProgramar, limiteCheckIn, efectivas, enHoras,
         minutosEntre, hoyALas, type Horario } from '../src/horario.ts'

let ok = 0, mal = 0
function afirmar(que: string, cierto: boolean) {
  if (cierto) { ok++; console.log('  OK   ' + que) }
  else { mal++; console.log('  FALLA ' + que) }
}

const H: Horario = {
  fecha: '2026-11-24', entrada: '09:00', salida: '18:00', minutos_comida: 60,
}
const alas = (hhmm: string) => hoyALas(hhmm, new Date(2026, 10, 24, 12, 0, 0))

console.log('--- cuentas del horario ---')
afirmar('nueve a seis son nueve horas', minutosEntre('09:00', '18:00') === 540)
afirmar('menos la comida, ocho efectivas', efectivas(H) === 480)
afirmar('se lee como horas', enHoras(480) === '8 h')
afirmar('con minutos tambien', enHoras(450) === '7 h 30 min')
afirmar('menos de una hora, solo minutos', enHoras(45) === '45 min')
afirmar('sin comida configurada no se descuenta nada',
        efectivas({ ...H, minutos_comida: 0 }) === 540)

console.log('--- la hora limite del check-in ---')
const lim = limiteCheckIn('08:30', H)
afirmar('es una hora antes de la primera visita',
        lim != null && lim.getHours() === 7 && lim.getMinutes() === 30)
const sinVisitas = limiteCheckIn(null, H)
afirmar('sin visitas con hora, se mide contra la entrada',
        sinVisitas != null && sinVisitas.getHours() === 8)
afirmar('sin horario ni visitas, no hay limite',
        limiteCheckIn(null, null) === null)

console.log('--- que avisos tocan ---')
// Son las 6 de la manana y la primera visita es a las 9: caben los dos.
let a = avisosAProgramar({ referencia: '09:00', yaHizoCheckIn: false,
                           ahora: new Date(2026, 10, 24, 6, 0, 0) })
afirmar('temprano caben los dos', a.length === 2)
afirmar('el primero dos horas antes',
        a[0].cuando.getHours() === 7 && a[0].cuando.getMinutes() === 0)
afirmar('el segundo una hora antes',
        a[1].cuando.getHours() === 8 && a[1].cuando.getMinutes() === 0)

// A las 7:30 el de dos horas ya paso: programarlo lo entregaria de
// inmediato, que asusta sin servir.
a = avisosAProgramar({ referencia: '09:00', yaHizoCheckIn: false,
                       ahora: new Date(2026, 10, 24, 7, 30, 0) })
afirmar('el que ya paso no se programa', a.length === 1 && a[0].minutos === 60)

// Despues de la hora limite no queda ninguno por poner.
a = avisosAProgramar({ referencia: '09:00', yaHizoCheckIn: false,
                       ahora: new Date(2026, 10, 24, 8, 30, 0) })
afirmar('pasada la hora limite, ninguno', a.length === 0)

// Y lo mas importante: a quien ya hizo el check-in no se le recuerda.
a = avisosAProgramar({ referencia: '09:00', yaHizoCheckIn: true,
                       ahora: new Date(2026, 10, 24, 6, 0, 0) })
afirmar('hecho el check-in, no se avisa nada', a.length === 0)

a = avisosAProgramar({ referencia: null, yaHizoCheckIn: false })
afirmar('sin referencia no se inventa una hora', a.length === 0)

console.log(`\n${ok} pasaron, ${mal} fallaron`)
if (mal) process.exitCode = 1
