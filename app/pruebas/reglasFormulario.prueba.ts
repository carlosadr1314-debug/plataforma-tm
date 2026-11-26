// Prueba de las reglas del formulario. Corre con: npm run prueba
import {
  seMuestra, contestada, pendientes, filaDeRespuesta, SIN_SOPORTE,
  type Pregunta, type Respuestas,
} from '../src/reglasFormulario.ts'

let ok = 0, mal = 0
function afirmar(que: string, cierto: boolean) {
  if (cierto) { ok++; console.log('  OK   ' + que) }
  else { mal++; console.log('  FALLA ' + que) }
}

const base = {
  orden: 1, config: {}, opcion_pregunta: [], condicion_pregunta: [],
  obligatoria: false,
}
const q = (x: Partial<Pregunta>): Pregunta =>
  ({ ...base, id: 'q', texto: 't', tipo: 'texto', ...x } as Pregunta)

console.log('--- cuando se muestra una pregunta condicional ---')
const sinCond = q({ id: 'a' })
afirmar('sin condiciones siempre se muestra', seMuestra(sinCond, {}))

const siHayExhibidor = q({
  id: 'b',
  condicion_pregunta: [{ depende_de_id: 'a', operador: 'igual', valor: true }],
})
afirmar('no se muestra si la de arriba no se ha contestado', !seMuestra(siHayExhibidor, {}))
afirmar('se muestra cuando la de arriba dice que si', seMuestra(siHayExhibidor, { a: true }))
afirmar('no se muestra cuando dice que no', !seMuestra(siHayExhibidor, { a: false }))

const dos = q({
  id: 'c',
  condicion_pregunta: [
    { depende_de_id: 'a', operador: 'igual', valor: true },
    { depende_de_id: 'x', operador: 'no_vacio', valor: null },
  ],
})
afirmar('con dos condiciones se exigen las dos', !seMuestra(dos, { a: true }))
afirmar('y se muestra cuando ambas se cumplen', seMuestra(dos, { a: true, x: 'algo' }))

const mult = q({
  id: 'd',
  condicion_pregunta: [{ depende_de_id: 'm', operador: 'igual', valor: 'o2' }],
})
afirmar('en opcion multiple, "igual" es "esta entre las elegidas"',
        seMuestra(mult, { m: ['o1', 'o2'] }))
afirmar('y no se muestra si no esta', !seMuestra(mult, { m: ['o1'] }))

const mayor = q({
  id: 'e',
  condicion_pregunta: [{ depende_de_id: 'n', operador: 'mayor', valor: 3 }],
})
afirmar('"mayor" compara numeros aunque lleguen como texto', seMuestra(mayor, { n: '5' }))
afirmar('y no se cumple con el mismo numero', !seMuestra(mayor, { n: '3' }))

console.log('--- cuando una respuesta cuenta como contestada ---')
const obl = q({ id: 'f', tipo: 'booleano', obligatoria: true })
afirmar('un "no" es una respuesta, no un vacio', contestada(obl, false, []))
afirmar('sin tocar, no esta contestada', !contestada(obl, undefined, []))
afirmar('el cero tambien es respuesta', contestada(q({ tipo: 'numero' }), 0, []))
afirmar('el texto vacio no', !contestada(q({ tipo: 'texto' }), '', []))
afirmar('una lista vacia tampoco', !contestada(q({ tipo: 'opcion_multiple' }), [], []))

const porSku = q({ id: 'g', tipo: 'existencia_sku', obligatoria: true })
afirmar('por SKU: media tabla no alcanza',
        !contestada(porSku, { s1: true }, ['s1', 's2']))
afirmar('por SKU: con todos, si', contestada(porSku, { s1: true, s2: false }, ['s1', 's2']))
afirmar('un cliente sin catalogo no bloquea', contestada(porSku, undefined, []))

console.log('--- las de foto cuentan evidencia, no respuesta ---')
const foto = q({ id: 'f1', tipo: 'foto', obligatoria: true })
afirmar('sin fotos, no esta contestada',
        !contestada(foto, undefined, [], {}))
afirmar('con una foto, si',
        contestada(foto, undefined, [], { f1: 1 }))
afirmar('la foto de OTRA pregunta no la cuenta',
        !contestada(foto, undefined, [], { f9: 3 }))
afirmar('una foto obligatoria sin tomar bloquea el cierre',
        pendientes([foto], {}, [], {}).length === 1)
afirmar('tomada, ya no bloquea',
        pendientes([foto], {}, [], { f1: 1 }).length === 0)

console.log('--- lo que falta para cerrar ---')
const form: Pregunta[] = [
  q({ id: 'p1', tipo: 'booleano', obligatoria: true }),
  q({ id: 'p2', tipo: 'texto', obligatoria: true,
      condicion_pregunta: [{ depende_de_id: 'p1', operador: 'igual', valor: false }] }),
  q({ id: 'p3', tipo: 'texto', obligatoria: false }),
]
afirmar('al abrir falta la primera', pendientes(form, {}, []).length === 1)
let r: Respuestas = { p1: true }
afirmar('contestando que si, no se pide la condicional', pendientes(form, r, []).length === 0)
r = { p1: false }
afirmar('contestando que no, aparece y se exige', pendientes(form, r, []).length === 1)
r = { p1: false, p2: 'se cayo el exhibidor' }
afirmar('contestada la condicional, ya no falta nada', pendientes(form, r, []).length === 0)
afirmar('las opcionales nunca bloquean',
        pendientes(form, r, []).every(p => p.id !== 'p3'))

console.log('--- firma y codigo de barras ---')
const firma = q({ id: 'fi', tipo: 'firma', obligatoria: true })
afirmar('sin firmar no esta contestada', !contestada(firma, undefined, []))
afirmar('una firma vacia tampoco', !contestada(firma, '', []))
afirmar('con trazos si',
        contestada(firma, '{"w":320,"h":170,"t":["M10,10 L20,20"]}', []))

const codigo = q({ id: 'cb', tipo: 'codigo_barras', obligatoria: true })
afirmar('sin codigo no esta contestada', !contestada(codigo, undefined, []))
afirmar('con codigo si', contestada(codigo, '7501234567890', []))
afirmar('la firma va a valor_texto tal cual',
        filaDeRespuesta(firma, '{"w":1,"h":1,"t":["M0,0"]}').valor_texto ===
          '{"w":1,"h":1,"t":["M0,0"]}')
afirmar('y el codigo tambien',
        filaDeRespuesta(codigo, '7501234567890').valor_texto === '7501234567890')
afirmar('ya ningun tipo queda sin soporte', SIN_SOPORTE.length === 0)

console.log('--- a que columna va cada tipo ---')
afirmar('booleano va a valor_bool',
        filaDeRespuesta(q({ tipo: 'booleano' }), true).valor_bool === true)
afirmar('numero va a valor_numero',
        filaDeRespuesta(q({ tipo: 'numero' }), '12.5').valor_numero === 12.5)
afirmar('opcion unica se guarda como lista de uno',
        JSON.stringify(filaDeRespuesta(q({ tipo: 'opcion_unica' }), 'o1').valor_opcion) === '["o1"]')
afirmar('texto va a valor_texto',
        filaDeRespuesta(q({ tipo: 'texto' }), 'hola').valor_texto === 'hola')
afirmar('precio por SKU va completo a valor_opcion',
        JSON.stringify(filaDeRespuesta(q({ tipo: 'precio_sku' }), { s1: 28.5 }).valor_opcion)
          === '{"s1":28.5}')

console.log(`\n${ok} pasaron, ${mal} fallaron`)
if (mal) process.exitCode = 1
