// Prueba de la cola de evidencia fotografica. Corre con: npm run prueba
//
// Lo que importa aqui no es que suba: es que NO se pierda. Una foto
// perdida no se puede volver a tomar, porque el promotor ya se fue de
// la tienda.

import { tomarFoto, fotosPendientes, fotosDe, descartarFoto,
         subirFotos, cuantasFotosFaltan, olvidarFotosDe,
         hayFotoDeLlegada } from '../src/fotos.ts'
import { estado, reiniciar } from './dobles/supabase.mjs'
import { _ponerFoto, _archivos, File } from './dobles/expo.mjs'

let ok = 0, mal = 0
function afirmar(que: string, cierto: boolean) {
  if (cierto) { ok++; console.log('  OK   ' + que) }
  else { mal++; console.log('  FALLA ' + que) }
}

const DATOS = {
  tipo: 'pregunta' as const,
  itinerarioId: 'it-7',
  preguntaId: 'p-1',
  clienteId: 'cli-1',
  lat: 19.58, lng: -99.01,
}

function hayCamara() {
  _ponerFoto({ canceled: false, assets: [{ uri: 'mem://camara/IMG_1.jpg', width: 3000, height: 4000 }] })
  _archivos.set('mem://camara/IMG_1.jpg', new Uint8Array(4_000_000))
}

;(async () => {
  reiniciar()

  console.log('--- tomar la foto ---')
  hayCamara()
  const r = await tomarFoto(DATOS)
  afirmar('la toma sale bien', r.ok === true)
  const id = r.ok ? r.foto.id : ''
  afirmar('queda apuntada como pendiente', Object.keys(await fotosPendientes()).length === 1)
  afirmar('el archivo vive fuera de la cache de la camara',
          r.ok && r.foto.archivo.startsWith('mem://doc/evidencia'))
  afirmar('se guardo reducida, no los 4 MB del original',
          r.ok && r.foto.bytes > 0 && r.foto.bytes < 1000)
  afirmar('guarda donde se tomo', r.ok && r.foto.lat === 19.58)
  afirmar('se puede listar por visita', (await fotosDe('it-7')).length === 1)

  console.log('--- cancelar no deja basura ---')
  _ponerFoto({ canceled: true, assets: null })
  const c = await tomarFoto(DATOS)
  afirmar('se reporta como cancelada', !c.ok && c.cancelada)
  afirmar('no agrega pendientes', Object.keys(await fotosPendientes()).length === 1)

  console.log('--- sin visita, la foto espera ---')
  let quedan = await subirFotos()
  afirmar('no se sube si la visita todavia no existe', quedan === 1)
  afirmar('y NO se borro del telefono', Object.keys(await fotosPendientes()).length === 1)
  afirmar('el archivo sigue ahi', new File((await fotosDe('it-7'))[0].archivo).exists)
  afirmar('no se invento ningun renglon', estado.evidencias.length === 0)

  console.log('--- con la visita ya creada, sube ---')
  estado.visitaPorItinerario['it-7'] = 'vis-7'
  quedan = await subirFotos()
  afirmar('ya no queda nada pendiente', quedan === 0)
  afirmar('llego una al bucket', estado.subidas.length === 1)
  afirmar('la ruta es empresa/cliente/visita/archivo',
          estado.subidas[0].ruta === `org-1/cli-1/vis-7/${id}.jpg`)
  afirmar('se escribio el renglon de evidencia', estado.evidencias.length === 1)
  afirmar('el renglon apunta a la pregunta', estado.evidencias[0].pregunta_id === 'p-1')

  // Lo que fallo en el telefono de verdad: al subir, la foto
  // desaparecia de la pantalla, la pregunta obligatoria volvia a
  // contar como sin contestar y la visita no se podia cerrar.
  afirmar('despues de subir, la foto SIGUE a la vista',
          (await fotosDe('it-7')).length === 1)
  afirmar('y queda marcada como entregada',
          (await fotosDe('it-7'))[0].subida === true)
  afirmar('el archivo sigue en el telefono para poder verla',
          new File(`mem://doc/evidencia/${id}.jpg`).exists)
  afirmar('ya no cuenta como pendiente de mandar', (await cuantasFotosFaltan()) === 0)

  console.log('--- al cerrar la visita si se suelta el espacio ---')
  await olvidarFotosDe('it-7')
  afirmar('se fue de la lista', (await fotosDe('it-7')).length === 0)
  afirmar('y el archivo tambien', !new File(`mem://doc/evidencia/${id}.jpg`).exists)

  console.log('--- si no hay red, se conserva ---')
  reiniciar()
  hayCamara()
  const r2 = await tomarFoto(DATOS)
  const id2 = r2.ok ? r2.foto.id : ''
  estado.visitaPorItinerario['it-7'] = 'vis-7'
  estado.fallaSubida = { message: 'Network request failed' }
  quedan = await subirFotos()
  afirmar('sigue pendiente', quedan === 1)
  afirmar('no se escribio renglon a medias', estado.evidencias.length === 0)
  afirmar('el archivo no se borro', new File(`mem://doc/evidencia/${id2}.jpg`).exists)

  console.log('--- y al volver la red, sale ---')
  estado.fallaSubida = null
  quedan = await subirFotos()
  afirmar('ahora si llega', quedan === 0 && estado.evidencias.length === 1)
  afirmar('sin perderla de vista', (await fotosDe('it-7')).length >= 1)
  await olvidarFotosDe('it-7')

  console.log('--- un reintento no la sube dos veces ---')
  reiniciar()
  await olvidarFotosDe('it-7')
  hayCamara()
  const r3 = await tomarFoto(DATOS)
  estado.visitaPorItinerario['it-7'] = 'vis-7'
  estado.fallaSubida = { message: 'Network request failed' }
  await subirFotos()                       // intentos pasa a 1
  estado.fallaSubida = null
  // Como si la subida anterior si hubiera entrado y solo faltara el renglon
  estado.evidencias.push({ storage_path: `org-1/cli-1/vis-7/${r3.ok ? r3.foto.id : ''}.jpg` })
  quedan = await subirFotos()
  afirmar('se da por entregada sin duplicar', quedan === 0 && estado.evidencias.length === 1)
  afirmar('y no se reenvio el archivo', estado.subidas.length === 0)

  console.log('--- descartar una mal tomada ---')
  reiniciar()
  await olvidarFotosDe('it-7')
  hayCamara()
  const r4 = await tomarFoto(DATOS)
  const id4 = r4.ok ? r4.foto.id : ''
  await descartarFoto(id4)
  afirmar('ya no esta en la lista', (await cuantasFotosFaltan()) === 0)
  afirmar('y su archivo tampoco', !new File(`mem://doc/evidencia/${id4}.jpg`).exists)

  console.log('--- la foto de regreso de comer cuelga de la jornada ---')
  reiniciar()
  await olvidarFotosDe('it-7')
  hayCamara()
  const rc = await tomarFoto({ tipo: 'regreso_comida', jornadaId: 'jor-3' })
  afirmar('se toma igual', rc.ok === true)
  afirmar('sin visita ni cliente',
          rc.ok && rc.foto.itinerario_id === null && rc.foto.cliente_id === null)

  // Y lo importante: NO espera a que exista una visita. Un promotor
  // volviendo de comer no tiene visita abierta, y si la foto esperara
  // una, no subiria nunca.
  quedan = await subirFotos()
  afirmar('sube sin esperar ninguna visita', quedan === 0)
  afirmar('a la ruta de jornada',
          estado.subidas[0]?.ruta === `org-1/jornada/jor-3/${rc.ok ? rc.foto.id : ''}.jpg`)
  afirmar('y el renglon dice de que es',
          estado.evidencias[0]?.tipo === 'regreso_comida' &&
          estado.evidencias[0]?.jornada_id === 'jor-3')

  console.log('--- la foto de llegada al punto de venta ---')
  reiniciar()
  hayCamara()
  const rl = await tomarFoto({ tipo: 'inicio_visita', itinerarioId: 'it-7', clienteId: 'cli-1' })
  afirmar('se reconoce como llegada', rl.ok && rl.foto.tipo === 'inicio_visita')
  afirmar('sin pregunta', rl.ok && rl.foto.pregunta_id === null)
  afirmar('se puede consultar si ya hay', (await hayFotoDeLlegada('it-7')) === true)
  afirmar('y de otra visita no', (await hayFotoDeLlegada('it-99')) === false)

  estado.visitaPorItinerario['it-7'] = 'vis-7'
  quedan = await subirFotos()
  afirmar('sube con la visita',
          quedan === 0 && estado.evidencias[0]?.tipo === 'inicio_visita')

  console.log(`\n${ok} pasaron, ${mal} fallaron`)
  if (mal) process.exitCode = 1
})()
