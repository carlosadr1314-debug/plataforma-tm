import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useSesion, puede } from '../lib/sesion'

type Fila = { id: string; nombre: string }
type Sku = {
  id: string; codigo: string; nombre: string
  codigo_barras: string | null; precio_sugerido: number | null
}

const pesos = (n: number | null) =>
  n === null ? '—' : n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })

export default function Catalogo() {
  const { perfil } = useSesion()
  const editable = puede(perfil, 'gestionar_catalogo')

  const [clientes, setClientes] = useState<Fila[]>([])
  const [cliente, setCliente] = useState('')

  const [productos, setProductos] = useState<Fila[]>([])
  const [producto, setProducto] = useState('')

  const [subs, setSubs] = useState<Fila[]>([])
  const [sub, setSub] = useState('')

  const [skus, setSkus] = useState<Sku[]>([])

  const [creando, setCreando] = useState<'' | 'producto' | 'subproducto'>('')
  const [texto, setTexto] = useState('')
  const [panelSku, setPanelSku] = useState(false)
  const [aviso, setAviso] = useState('')

  // --- cargas encadenadas -------------------------------------------
  useEffect(() => {
    supabase.from('cliente').select('id,nombre').order('nombre')
      .then(({ data }) => {
        setClientes(data ?? [])
        if (data?.length) setCliente(data[0].id)
      })
  }, [])

  useEffect(() => {
    setProducto(''); setSubs([]); setSub(''); setSkus([])
    if (!cliente) { setProductos([]); return }
    supabase.from('producto').select('id,nombre').eq('cliente_id', cliente).order('nombre')
      .then(({ data }) => setProductos(data ?? []))
  }, [cliente])

  useEffect(() => {
    setSub(''); setSkus([])
    if (!producto) { setSubs([]); return }
    supabase.from('subproducto').select('id,nombre').eq('producto_id', producto).order('nombre')
      .then(({ data }) => setSubs(data ?? []))
  }, [producto])

  useEffect(() => {
    if (!sub) { setSkus([]); return }
    supabase.from('sku')
      .select('id,codigo,nombre,codigo_barras,precio_sugerido')
      .eq('subproducto_id', sub).order('codigo')
      .then(({ data }) => setSkus(data ?? []))
  }, [sub])

  // --- alta rapida de producto y subproducto ------------------------
  async function guardarNombre(e: FormEvent) {
    e.preventDefault()
    setAviso('')
    const nombre = texto.trim()
    if (!nombre) { setAviso('Escribe un nombre antes de guardar.'); return }

    if (creando === 'producto') {
      const { error } = await supabase.from('producto').insert({ cliente_id: cliente, nombre })
      if (error) { setAviso(mensaje(error)); return }
      const { data } = await supabase.from('producto').select('id,nombre')
        .eq('cliente_id', cliente).order('nombre')
      setProductos(data ?? [])
    } else {
      const { error } = await supabase.from('subproducto').insert({ producto_id: producto, nombre })
      if (error) { setAviso(mensaje(error)); return }
      const { data } = await supabase.from('subproducto').select('id,nombre')
        .eq('producto_id', producto).order('nombre')
      setSubs(data ?? [])
    }
    setTexto(''); setCreando('')
  }

  const mensaje = (e: { code?: string; message: string }) =>
    e.code === '23505'
      ? 'Ya existe un registro con ese nombre. Usa uno distinto.'
      : 'No se pudo guardar. ' + e.message

  // --- alta de SKU ---------------------------------------------------
  const skuVacio = { codigo: '', nombre: '', codigo_barras: '', precio_sugerido: '' }
  const [formSku, setFormSku] = useState({ ...skuVacio })
  const [errSku, setErrSku] = useState<Record<string, string>>({})
  const [guardando, setGuardando] = useState(false)

  async function guardarSku(e: FormEvent) {
    e.preventDefault()
    setAviso('')
    const err: Record<string, string> = {}
    if (!formSku.codigo.trim()) err.codigo = 'Escribe un código, por ejemplo TV-003'
    if (!formSku.nombre.trim()) err.nombre = 'Escribe el nombre del producto'
    const precio = parseFloat(formSku.precio_sugerido)
    if (formSku.precio_sugerido && (isNaN(precio) || precio < 0))
      err.precio_sugerido = 'Usa un número mayor o igual a cero'
    setErrSku(err)
    if (Object.keys(err).length) return

    setGuardando(true)
    const { error } = await supabase.from('sku').insert({
      subproducto_id: sub,
      codigo: formSku.codigo.trim(),
      nombre: formSku.nombre.trim(),
      codigo_barras: formSku.codigo_barras.trim() || null,
      precio_sugerido: formSku.precio_sugerido ? precio : null,
    })
    setGuardando(false)
    if (error) { setAviso(mensaje(error)); return }

    const { data } = await supabase.from('sku')
      .select('id,codigo,nombre,codigo_barras,precio_sugerido')
      .eq('subproducto_id', sub).order('codigo')
    setSkus(data ?? [])
    setFormSku({ ...skuVacio }); setPanelSku(false)
  }

  const campoSku = (llave: keyof typeof skuVacio, etiqueta: string, tipo = 'text') => (
    <div className={'campo' + (errSku[llave] ? ' malo' : '')}>
      <label htmlFor={llave}>{etiqueta}</label>
      <input id={llave} type={tipo} step={tipo === 'number' ? '0.01' : undefined}
        value={formSku[llave]}
        onChange={e => setFormSku({ ...formSku, [llave]: e.target.value })}
        aria-describedby={errSku[llave] ? llave + '-e' : undefined} />
      {errSku[llave] && <span className="err" id={llave + '-e'}>{errSku[llave]}</span>}
    </div>
  )

  // --- render ---------------------------------------------------------
  return (
    <>
      <div className="tope">
        <div>
          <h2 className="disp">Catálogo</h2>
          <p>Cliente, producto, subproducto y SKU</p>
        </div>
        {clientes.length > 1 && (
          <div className="campo" style={{ margin: 0, minWidth: 200 }}>
            <label htmlFor="cl">Cliente</label>
            <select id="cl" value={cliente} onChange={e => setCliente(e.target.value)}>
              {clientes.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </div>
        )}
      </div>

      {aviso && <div className="aviso error" role="alert">{aviso}</div>}

      <div className="cols">
        {/* productos */}
        <section className="col">
          <header>
            <h3>Productos</h3>
            <span>{productos.length}</span>
          </header>
          <ul>
            {productos.map(p => (
              <li key={p.id}>
                <button className={p.id === producto ? 'on' : ''}
                  onClick={() => setProducto(p.id)}>{p.nombre}</button>
              </li>
            ))}
          </ul>
          {productos.length === 0 && (
            <p className="sinnada">Sin productos.{editable ? ' Agrega el primero abajo.' : ''}</p>
          )}
          {editable && (creando === 'producto' ? (
            <form className="nuevo" onSubmit={guardarNombre}>
              <input autoFocus value={texto} onChange={e => setTexto(e.target.value)}
                placeholder="Nombre del producto" aria-label="Nombre del producto" />
              <button>Guardar</button>
              <button type="button" className="x"
                onClick={() => { setCreando(''); setTexto(''); setAviso('') }}>✕</button>
            </form>
          ) : (
            <footer>
              <button className="agregar" onClick={() => { setCreando('producto'); setTexto('') }}>
                + Agregar producto
              </button>
            </footer>
          ))}
        </section>

        {/* subproductos */}
        <section className="col">
          <header>
            <h3>Subproductos</h3>
            <span>{producto ? subs.length : ''}</span>
          </header>
          {!producto ? (
            <p className="sinnada">Elige un producto para ver sus subproductos.</p>
          ) : (
            <>
              <ul>
                {subs.map(s => (
                  <li key={s.id}>
                    <button className={s.id === sub ? 'on' : ''}
                      onClick={() => setSub(s.id)}>{s.nombre}</button>
                  </li>
                ))}
              </ul>
              {subs.length === 0 && <p className="sinnada">Sin subproductos.</p>}
              {editable && (creando === 'subproducto' ? (
                <form className="nuevo" onSubmit={guardarNombre}>
                  <input autoFocus value={texto} onChange={e => setTexto(e.target.value)}
                    placeholder="Nombre del subproducto" aria-label="Nombre del subproducto" />
                  <button>Guardar</button>
                  <button type="button" className="x"
                    onClick={() => { setCreando(''); setTexto(''); setAviso('') }}>✕</button>
                </form>
              ) : (
                <footer>
                  <button className="agregar"
                    onClick={() => { setCreando('subproducto'); setTexto('') }}>
                    + Agregar subproducto
                  </button>
                </footer>
              ))}
            </>
          )}
        </section>

        {/* skus */}
        <section className="col">
          <header>
            <h3>SKUs</h3>
            <span>{sub ? skus.length : ''}</span>
          </header>
          {!sub ? (
            <p className="sinnada">Elige un subproducto para ver sus SKUs.</p>
          ) : (
            <>
              <div style={{ overflowX: 'auto', flex: 1 }}>
                <table className="skus">
                  <thead>
                    <tr><th>Código</th><th>Nombre</th><th>Barras</th><th className="der">Sugerido</th></tr>
                  </thead>
                  <tbody>
                    {skus.map(k => (
                      <tr key={k.id}>
                        <td className="num"><b>{k.codigo}</b></td>
                        <td>{k.nombre}</td>
                        <td className="num">{k.codigo_barras ?? '—'}</td>
                        <td className="num der">{pesos(k.precio_sugerido)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {skus.length === 0 && <p className="sinnada">Sin SKUs en este subproducto.</p>}
              </div>
              {editable && (
                <footer>
                  <button className="agregar" onClick={() => { setPanelSku(true); setErrSku({}) }}>
                    + Agregar SKU
                  </button>
                </footer>
              )}
            </>
          )}
        </section>
      </div>

      {panelSku && (
        <>
          <div className="velo" onClick={() => setPanelSku(false)} />
          <div className="panel" role="dialog" aria-modal="true" aria-label="Nuevo SKU">
            <h3>Nuevo SKU</h3>
            <form onSubmit={guardarSku} noValidate>
              {campoSku('codigo', 'Código')}
              {campoSku('nombre', 'Nombre')}
              {campoSku('codigo_barras', 'Código de barras')}
              {campoSku('precio_sugerido', 'Precio sugerido (MXN)', 'number')}
              <div className="dos" style={{ marginTop: 6 }}>
                <button type="button" className="btn sec" onClick={() => setPanelSku(false)}>
                  Cancelar
                </button>
                <button className="btn" disabled={guardando}>
                  {guardando ? 'Guardando…' : 'Guardar'}
                </button>
              </div>
            </form>
          </div>
        </>
      )}
    </>
  )
}
