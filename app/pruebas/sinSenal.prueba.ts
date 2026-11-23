// Prueba de la logica de trabajar sin señal. Corre con: npm run prueba
// No necesita instalar nada: Node 22 ejecuta TypeScript por si mismo.

import { apuntar, pendientes, sincronizar, guardarRuta, rutaGuardada,
         apuntarRespuestas, respuestasGuardadas, olvidarRespuestas } from '../src/sinSenal.ts'
import { estado } from './dobles/supabase.mjs'

let ok = 0, mal = 0
function afirmar(que: string, cierto: boolean) {
  if (cierto) { ok++; console.log('  OK   ' + que) }
  else { mal++; console.log('  FALLA ' + que) }
}

;(async () => {
  console.log('--- se funden los cambios de una misma visita ---')
  await apuntar('it-1', { estado: 'en_curso', check_in: 'T1', distancia_pdv: 34 })
  await apuntar('it-1', { estado: 'completada', check_out: 'T2' })
  let p = await pendientes()
  afirmar('queda un solo registro para esa visita', Object.keys(p).length === 1)
  afirmar('conserva la llegada', p['it-1'].check_in === 'T1')
  afirmar('y la distancia medida', p['it-1'].distancia_pdv === 34)
  afirmar('con el estado final', p['it-1'].estado === 'completada')
  afirmar('y el itinerario dentro', p['it-1'].itinerario_id === 'it-1')

  console.log('--- sin red no se pierde nada ---')
  await apuntar('it-2', { estado: 'en_curso', check_in: 'T3' })
  estado.falla = { message: 'Network request failed' }
  let quedan = await sincronizar()
  afirmar('las dos siguen pendientes', quedan === 2)
  afirmar('no se mando nada', estado.enviados.length === 0)

  console.log('--- al volver la red salen solas ---')
  estado.falla = null
  quedan = await sincronizar()
  afirmar('no queda ninguna', quedan === 0)
  afirmar('se mandaron las dos', estado.enviados.length === 2)
  afirmar('con sello de sincronizacion', !!estado.enviados[0].sincronizada_en)
  p = await pendientes()
  afirmar('la lista quedo vacia', Object.keys(p).length === 0)

  console.log('--- un error que no es de red no se reintenta para siempre ---')
  await apuntar('it-3', { estado: 'en_curso' })
  estado.falla = { message: 'new row violates row-level security policy' }
  quedan = await sincronizar()
  afirmar('se suelta en vez de atorar la cola', quedan === 0)

  console.log('--- las respuestas del formulario ---')
  estado.falla = null
  estado.respuestas.length = 0
  await apuntarRespuestas('it-9', { p1: { tipo: 'booleano', valor: true } })
  await apuntarRespuestas('it-9', { p2: { tipo: 'numero', valor: 28.5 } })
  let rs = await respuestasGuardadas('it-9')
  afirmar('se funden, no se pisan', Object.keys(rs).length === 2)

  // Sin visita en el servidor no hay donde colgarlas: esperan.
  quedan = await sincronizar()
  afirmar('sin visita, las respuestas esperan', quedan === 1)
  afirmar('y no se mando ninguna', estado.respuestas.length === 0)

  // Con la llegada apuntada, la visita sale primero y las respuestas
  // se cuelgan de su id.
  await apuntar('it-9', { estado: 'en_curso', check_in: 'T9' })
  quedan = await sincronizar()
  afirmar('ya con llegada, todo sale', quedan === 0)
  afirmar('se mandaron las dos respuestas', estado.respuestas.length === 2)
  afirmar('colgadas de la visita correcta',
          estado.respuestas.every(r => r.visita_id === 'v-it-9'))
  afirmar('el booleano en su columna',
          estado.respuestas.find(r => r.pregunta_id === 'p1')?.valor_bool === true)
  afirmar('el numero en la suya',
          estado.respuestas.find(r => r.pregunta_id === 'p2')?.valor_numero === 28.5)

  // Lo que fallo en el telefono de verdad: al sincronizar se vacia la
  // lista de pendientes, y el formulario leia de ahi. El promotor
  // contestaba veinticinco preguntas, se guardaban bien, volvia a
  // entrar y la pantalla estaba en blanco: lo entregado se veia como
  // nunca capturado y la visita no se podia cerrar.
  console.log('--- lo entregado sigue siendo lo contestado ---')
  rs = await respuestasGuardadas('it-9')
  afirmar('despues de mandarlas, el formulario las SIGUE viendo',
          Object.keys(rs).length === 2)
  afirmar('con su valor intacto', rs.p2?.valor === 28.5)
  afirmar('y ya no hay nada pendiente de mandar', (await sincronizar()) === 0)

  await olvidarRespuestas('it-9')
  afirmar('al cerrar la visita si se sueltan',
          Object.keys(await respuestasGuardadas('it-9')).length === 0)

  console.log('--- la ruta guardada es solo la de hoy ---')
  estado.falla = null
  await guardarRuta('2026-11-20', [{ id: 'it-1' }])
  afirmar('se lee la de hoy', (await rutaGuardada('2026-11-20'))?.paradas.length === 1)
  afirmar('la de ayer no se usa', (await rutaGuardada('2026-11-19')) === null)

  console.log(`\n${ok} pasaron, ${mal} fallaron`)
  if (mal) process.exitCode = 1
})()
