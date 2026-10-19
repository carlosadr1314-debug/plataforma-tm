import { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useSesion, puede } from '../lib/sesion'
import { TIPOS, CON_OPCIONES, CON_SKU, OPERADORES } from '../lib/tipos'

type Pregunta = {
  id: string; orden: number; texto: string; tipo: string
  obligatoria: boolean; sku_id: string | null; config: any
}
type Opcion = { id: string; orden: number; texto: string }
type Cond = { id: string; depende_de_id: string; operador: string; valor: any }
type Sku = { id: string; codigo: string; nombre: string }

export default function FormularioEditor() {
  const { id } = useParams()
  const ir = useNavigate()
  const { perfil } = useSesion()
  const editable = puede(perfil, 'crear_formularios')

  const [form, setForm] = useState<any>(null)
  const [preg, setPreg] = useState<Pregunta[]>([])
  const [sel, setSel] = useState<string>('')
  const [ops, setOps] = useState<Opcion[]>([])
  const [cond, setCond] = useState<Cond | null>(null)
  const [skus, setSkus] = useState<Sku[]>([])
  const [aviso, setAviso] = useState('')
  const [ok, setOk] = useState('')

  const actual = preg.find(p => p.id === sel) ?? null

  const cargarPreguntas = useCallback(async () => {
    const { data } = await supabase.from('pregunta')
      .select('id,orden,texto,tipo,obligatoria,sku_id,config')
      .eq('formulario_id', id).order('orden')
    setPreg(data ?? [])
    return data ?? []
  }, [id])

  useEffect(() => {
    (async () => {
      const { data: f } = await supabase.from('formulario')
        .select('id,nombre,descripcion,version,es_plantilla,cliente_id,cliente:cliente_id(nombre)')
        .eq('id', id).maybeSingle()
      setForm(f)
      const ps = await cargarPreguntas()
      if (ps.length) setSel(ps[0].id)

      const { data: sk } = await supabase.from('sku')
        .select('id,codigo,nombre,subproducto:subproducto_id(producto:producto_id(cliente_id))')
        .order('codigo')
      const filtrados = (sk ?? []).filter((s: any) =>
        !f?.cliente_id || s.subproducto?.producto?.cliente_id === f.cliente_id)
      setSkus(filtrados as any)
    })()
  }, [id, cargarPreguntas])

  // opciones y condicion de la pregunta seleccionada
  useEffect(() => {
    if (!sel) { setOps([]); setCond(null); return }
    supabase.from('opcion_pregunta').select('id,orden,texto')
      .eq('pregunta_id', sel).order('orden').then(({ data }) => setOps(data ?? []))
    supabase.from('condicion_pregunta').select('id,depende_de_id,operador,valor')
      .eq('pregunta_id', sel).maybeSingle().then(({ data }) => setCond(data as any))
  }, [sel])

  function flash(m: string) { setOk(m); setTimeout(() => setOk(''), 2200) }

  async function agregar() {
    setAviso('')
    const orden = preg.length ? Math.max(...preg.map(p => p.orden)) + 1 : 1
    const { data, error } = await supabase.from('pregunta').insert({
      formulario_id: id, orden, texto: 'Pregunta nueva', tipo: 'texto', obligatoria: false,
    }).select('id').single()
    if (error) { setAviso('No se pudo agregar. ' + error.message); return }
    await cargarPreguntas()
    setSel(data!.id)
  }

  async function guardar(campos: Partial<Pregunta>) {
    if (!actual) return
    setAviso('')
    const { error } = await supabase.from('pregunta').update(campos).eq('id', actual.id)
    if (error) { setAviso('No se pudo guardar. ' + error.message); return }
    setPreg(preg.map(p => p.id === actual.id ? { ...p, ...campos } as Pregunta : p))
  }

  async function borrar() {
    if (!actual) return
    const { error } = await supabase.from('pregunta').delete().eq('id', actual.id)
    if (error) { setAviso('No se pudo eliminar. ' + error.message); return }
    const ps = await cargarPreguntas()
    setSel(ps[0]?.id ?? '')
    flash('Pregunta eliminada')
  }

  async function mover(dir: -1 | 1) {
    if (!actual) return
    const i = preg.findIndex(p => p.id === actual.id)
    const j = i + dir
    if (j < 0 || j >= preg.length) return
    const a = preg[i], b = preg[j]
    // intercambio en dos pasos para no chocar con la restriccion unica
    await supabase.from('pregunta').update({ orden: -1 }).eq('id', a.id)
    await supabase.from('pregunta').update({ orden: a.orden }).eq('id', b.id)
    await supabase.from('pregunta').update({ orden: b.orden }).eq('id', a.id)
    await cargarPreguntas()
  }

  // ---- opciones de respuesta ----
  async function addOpcion() {
    const orden = ops.length ? Math.max(...ops.map(o => o.orden)) + 1 : 1
    const { data } = await supabase.from('opcion_pregunta')
      .insert({ pregunta_id: sel, orden, texto: 'Opcion' }).select('id,orden,texto').single()
    if (data) setOps([...ops, data])
  }
  async function setOpcion(oid: string, texto: string) {
    setOps(ops.map(o => o.id === oid ? { ...o, texto } : o))
    await supabase.from('opcion_pregunta').update({ texto }).eq('id', oid)
  }
  async function delOpcion(oid: string) {
    await supabase.from('opcion_pregunta').delete().eq('id', oid)
    setOps(ops.filter(o => o.id !== oid))
  }

  // ---- condicion ----
  async function setCondicion(depende_de_id: string, operador: string, valor: string) {
    if (!depende_de_id) {
      if (cond) { await supabase.from('condicion_pregunta').delete().eq('id', cond.id); setCond(null) }
      return
    }
    let v: any = valor
    if (valor === 'true' || valor === 'false') v = valor === 'true'
    else if (valor !== '' && !isNaN(Number(valor))) v = Number(valor)

    if (cond) {
      await supabase.from('condicion_pregunta')
        .update({ depende_de_id, operador, valor: v }).eq('id', cond.id)
      setCond({ ...cond, depende_de_id, operador, valor: v })
    } else {
      const { data } = await supabase.from('condicion_pregunta')
        .insert({ pregunta_id: sel, depende_de_id, operador, valor: v })
        .select('id,depende_de_id,operador,valor').single()
      if (data) setCond(data as any)
    }
  }

  if (!form) return <p className="vacio">Cargando formulario…</p>

  const tieneCond = (pid: string) => cond && cond.id && sel === pid

  return (
    <>
      <div className="tope">
        <div>
          <button className="btn sec" style={{ minHeight: 34, fontSize: 13, marginBottom: 8 }}
            onClick={() => ir('/formularios')}>← Formularios</button>
          <h2 className="disp">{form.nombre}</h2>
          <p>
            {form.es_plantilla ? 'Plantilla estandar' : (form.cliente?.nombre ?? 'Sin cliente')}
            {' · '}v{form.version} · {preg.length} preguntas
          </p>
        </div>
        {editable && <button className="btn" onClick={agregar}>Agregar pregunta</button>}
      </div>

      {aviso && <div className="aviso error" role="alert">{aviso}</div>}
      {ok && <div className="aviso ok" role="status">{ok}</div>}

      <div className="editor">
        <div className="lienzo">
          {preg.length === 0 ? (
            <p className="vacio-ed">
              Este formulario no tiene preguntas todavia.<br />
              {editable ? 'Usa el boton de arriba para agregar la primera.' : ''}
            </p>
          ) : preg.map(p => (
            <button key={p.id} className={'qitem' + (p.id === sel ? ' sel' : '')}
              onClick={() => setSel(p.id)} aria-pressed={p.id === sel}>
              <span className="ord">{p.orden}</span>
              <span className="qt">
                <span className="q1">{p.texto}</span>
                <span className="q2">
                  {p.sku_id
                    ? (skus.find(s => s.id === p.sku_id)?.nombre ?? 'SKU')
                    : 'Sin producto asociado'}
                  {' · '}{p.obligatoria ? 'Obligatoria' : 'Opcional'}
                </span>
              </span>
              {tieneCond(p.id) && <span className="tipo cond">Condicional</span>}
              <span className="tipo">{TIPOS[p.tipo] ?? p.tipo}</span>
            </button>
          ))}
        </div>

        <aside className="props">
          <h4>Propiedades</h4>
          {!actual ? (
            <p style={{ fontSize: 13, color: 'var(--tinta-2)' }}>
              Elige una pregunta para ver sus propiedades.
            </p>
          ) : (
            <>
              <div className="campo">
                <label htmlFor="pt">Texto de la pregunta</label>
                <textarea id="pt" rows={2} disabled={!editable} value={actual.texto}
                  onChange={e => setPreg(preg.map(p => p.id === sel
                    ? { ...p, texto: e.target.value } : p))}
                  onBlur={e => guardar({ texto: e.target.value })} />
              </div>

              <div className="campo">
                <label htmlFor="pty">Tipo</label>
                <select id="pty" disabled={!editable} value={actual.tipo}
                  onChange={e => guardar({ tipo: e.target.value })}>
                  {Object.entries(TIPOS).map(([k, v]) =>
                    <option key={k} value={k}>{v}</option>)}
                </select>
              </div>

              {CON_SKU.includes(actual.tipo) && (
                <div className="campo">
                  <label htmlFor="psk">Producto asociado</label>
                  <select id="psk" disabled={!editable} value={actual.sku_id ?? ''}
                    onChange={e => guardar({ sku_id: e.target.value || null })}>
                    <option value="">Sin producto</option>
                    {skus.map(s => (
                      <option key={s.id} value={s.id}>{s.codigo} — {s.nombre}</option>
                    ))}
                  </select>
                </div>
              )}

              <div className="sw">
                <span>Respuesta obligatoria</span>
                <button type="button" disabled={!editable}
                  aria-pressed={actual.obligatoria} aria-label="Respuesta obligatoria"
                  onClick={() => guardar({ obligatoria: !actual.obligatoria })}><span /></button>
              </div>

              {CON_OPCIONES.includes(actual.tipo) && (
                <>
                  <hr className="sep" />
                  <h4>Opciones de respuesta</h4>
                  <ul className="ops">
                    {ops.map(o => (
                      <li key={o.id}>
                        <input value={o.texto} disabled={!editable}
                          aria-label={'Opcion ' + o.orden}
                          onChange={e => setOps(ops.map(x => x.id === o.id
                            ? { ...x, texto: e.target.value } : x))}
                          onBlur={e => setOpcion(o.id, e.target.value)} />
                        {editable && (
                          <button type="button" aria-label="Quitar opcion"
                            onClick={() => delOpcion(o.id)}>✕</button>
                        )}
                      </li>
                    ))}
                  </ul>
                  {editable && (
                    <div className="mini">
                      <button type="button" onClick={addOpcion}>+ Agregar opcion</button>
                    </div>
                  )}
                </>
              )}

              <hr className="sep" />
              <h4>Mostrar solo si…</h4>
              <div className="campo">
                <label htmlFor="pc">Depende de la pregunta</label>
                <select id="pc" disabled={!editable} value={cond?.depende_de_id ?? ''}
                  onChange={e => setCondicion(e.target.value,
                    cond?.operador ?? 'igual', String(cond?.valor ?? ''))}>
                  <option value="">Siempre se muestra</option>
                  {preg.filter(p => p.id !== actual.id && p.orden < actual.orden)
                    .map(p => <option key={p.id} value={p.id}>{p.orden}. {p.texto}</option>)}
                </select>
              </div>
              {cond?.depende_de_id && (
                <>
                  <div className="campo">
                    <label htmlFor="po">Condicion</label>
                    <select id="po" disabled={!editable} value={cond.operador}
                      onChange={e => setCondicion(cond.depende_de_id, e.target.value,
                        String(cond.valor ?? ''))}>
                      {Object.entries(OPERADORES).map(([k, v]) =>
                        <option key={k} value={k}>{v}</option>)}
                    </select>
                  </div>
                  {!['vacio', 'no_vacio'].includes(cond.operador) && (
                    <div className="campo">
                      <label htmlFor="pv">Valor</label>
                      <input id="pv" disabled={!editable} defaultValue={String(cond.valor ?? '')}
                        placeholder="Por ejemplo: false"
                        onBlur={e => setCondicion(cond.depende_de_id, cond.operador, e.target.value)} />
                    </div>
                  )}
                  <p style={{ fontSize: 11.5, color: 'var(--tinta-2)', margin: '-4px 0 12px' }}>
                    Para preguntas de Si / No escribe <b>true</b> o <b>false</b>.
                  </p>
                </>
              )}

              {editable && (
                <>
                  <hr className="sep" />
                  <div className="mini" style={{ marginBottom: 8 }}>
                    <button type="button" onClick={() => mover(-1)}>↑ Subir</button>
                    <button type="button" onClick={() => mover(1)}>↓ Bajar</button>
                  </div>
                  <div className="mini">
                    <button type="button" className="peligro" onClick={borrar}>
                      Eliminar pregunta
                    </button>
                  </div>
                </>
              )}
            </>
          )}
        </aside>
      </div>
    </>
  )
}
