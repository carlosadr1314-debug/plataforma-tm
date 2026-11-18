import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useSesion, puede } from '../lib/sesion'
import { IcoLapiz } from '../componentes/Iconos'

// =====================================================================
// Catalogo: cliente > producto > subproducto > SKU
//
// Nada se borra, se desactiva. Las respuestas y la evidencia de
// visitas pasadas apuntan a estos registros: si se borra un SKU se
// rompe el historial y los reportes viejos dejan de cuadrar. Al
// desactivarlo deja de aparecer en formularios nuevos y lo ya
// capturado sigue en pie.
// =====================================================================

type Fila = { id: string; nombre: string; activo: boolean }
type Sku = {
  id: string; codigo: string; nombre: string
  codigo_barras: string | null; precio_sugerido: number | null; activo: boolean
}

const pesos = (n: number | null) =>
  n === null ? '—' : n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })

const skuVacio = { codigo: '', nombre: '', codigo_barras: '', precio_sugerido: '', activo: true }

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

  const [verInactivos, setVerInactivos] = useState(false)
  const [aviso, setAviso] = useState('')
  const [ok, setOk] = useState('')

  // Alta y edicion de producto / subproducto comparten formulario.
  // La clave dice que se esta tocando: 'nuevo:producto', 'producto:<id>'
  const [editando, setEditando] = useState('')
  const [texto, setTexto] = useState('')
  const [activoEd, setActivoEd] = useState(true)

  const [panelSku, setPanelSku] = useState(false)
  const [skuEditando, setSkuEditando] = useState('')
  const [formSku, setFormSku] = useState({ ...skuVacio })
  const [errSku, setErrSku] = useState<Record<string, string>>({})
  const [guardando, setGuardando] = useState(false)

  const mensaje = (e: { code?: string; message: string }) =>
    e.code === '23505'
      ? 'Ya existe un registro con ese nombre o código. Usa uno distinto.'
      : e.code === '42501'
      ? 'Tu perfil no tiene permiso para modificar el catálogo.'
      : 'No se pudo guardar. ' + e.message

  // --- cargas encadenadas -------------------------------------------
  const traerProductos = (cl: string) =>
    supabase.from('producto').select('id,nombre,activo').eq('cliente_id', cl)
      .order('nombre').then(({ data }) => setProductos(data ?? []))

  const traerSubs = (pr: string) =>
    supabase.from('subproducto').select('id,nombre,activo').eq('producto_id', pr)
      .order('nombre').then(({ data }) => setSubs(data ?? []))

  const traerSkus = (sb: string) =>
    supabase.from('sku').select('id,codigo,nombre,codigo_barras,precio_sugerido,activo')
      .eq('subproducto_id', sb).order('codigo').then(({ data }) => setSkus(data ?? []))

  useEffect(() => {
    supabase.from('cliente').select('id,nombre,activo').order('nombre')
      .then(({ data }) => {
        setClientes(data ?? [])
        if (data?.length) setCliente(data[0].id)
      })
  }, [])

  useEffect(() => {
    setProducto(''); setSubs([]); setSub(''); setSkus([]); cerrarEdicion()
    if (!cliente) { setProductos([]); return }
    traerProductos(cliente)
  }, [cliente])

  useEffect(() => {
    setSub(''); setSkus([]); cerrarEdicion()
    if (!producto) { setSubs([]); return }
    traerSubs(producto)
  }, [producto])

  useEffect(() => {
    if (!sub) { setSkus([]); return }
    traerSkus(sub)
  }, [sub])

  // --- producto y subproducto ----------------------------------------
  function cerrarEdicion() {
    setEditando(''); setTexto(''); setActivoEd(true); setAviso('')
  }

  function abrirNuevo(que: 'producto' | 'subproducto') {
    setEditando('nuevo:' + que); setTexto(''); setActivoEd(true); setAviso(''); setOk('')
  }

  // Editar abre el mismo panel que los SKUs. Una columna de 250px no
  // da para meter campo, casilla y dos botones sin que se amontone.
  function abrirEdicion(que: 'producto' | 'subproducto', f: Fila) {
    setEditando(que + ':' + f.id); setTexto(f.nombre); setActivoEd(f.activo)
    setAviso(''); setOk('')
  }
  const enEdicion = editando.startsWith('producto:') || editando.startsWith('subproducto:')
  const queEdita = editando.split(':')[0] as 'producto' | 'subproducto'
  const idEdita = editando.split(':')[1]

  async function guardarFila(e: FormEvent, que: 'producto' | 'subproducto', id?: string) {
    e.preventDefault()
    setAviso('')
    const nombre = texto.trim()
    if (!nombre) { setAviso('Escribe un nombre antes de guardar.'); return }

    const tabla = que === 'producto' ? 'producto' : 'subproducto'
    const { error } = id
      ? await supabase.from(tabla).update({ nombre, activo: activoEd }).eq('id', id)
      : await supabase.from(tabla).insert(
          que === 'producto' ? { cliente_id: cliente, nombre } : { producto_id: producto, nombre })

    if (error) { setAviso(mensaje(error)); return }

    if (que === 'producto') await traerProductos(cliente)
    else await traerSubs(producto)

    setOk(id ? 'Cambios guardados.' : 'Agregado.')
    cerrarEdicion()
  }

  // --- SKU -------------------------------------------------------------
  function abrirSkuNuevo() {
    setSkuEditando(''); setFormSku({ ...skuVacio }); setErrSku({}); setAviso(''); setOk('')
    setPanelSku(true)
  }

  function abrirSkuEdicion(k: Sku) {
    setSkuEditando(k.id)
    setFormSku({
      codigo: k.codigo, nombre: k.nombre,
      codigo_barras: k.codigo_barras ?? '',
      precio_sugerido: k.precio_sugerido === null ? '' : String(k.precio_sugerido),
      activo: k.activo,
    })
    setErrSku({}); setAviso(''); setOk(''); setPanelSku(true)
  }

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

    const datos = {
      codigo: formSku.codigo.trim(),
      nombre: formSku.nombre.trim(),
      codigo_barras: formSku.codigo_barras.trim() || null,
      precio_sugerido: formSku.precio_sugerido ? precio : null,
      activo: formSku.activo,
    }

    setGuardando(true)
    const { error } = skuEditando
      ? await supabase.from('sku').update(datos).eq('id', skuEditando)
      : await supabase.from('sku').insert({ ...datos, subproducto_id: sub })
    setGuardando(false)

    if (error) { setAviso(mensaje(error)); return }
    await traerSkus(sub)
    setOk(skuEditando ? 'SKU actualizado.' : 'SKU agregado.')
    setPanelSku(false); setSkuEditando(''); setFormSku({ ...skuVacio })
  }

  const campoSku = (llave: 'codigo' | 'nombre' | 'codigo_barras' | 'precio_sugerido',
                    etiqueta: string, tipo = 'text') => (
    <div className={'campo' + (errSku[llave] ? ' malo' : '')}>
      <label htmlFor={llave}>{etiqueta}</label>
      <input id={llave} type={tipo} step={tipo === 'number' ? '0.01' : undefined}
        value={formSku[llave]}
        onChange={e => setFormSku({ ...formSku, [llave]: e.target.value })}
        aria-describedby={errSku[llave] ? llave + '-e' : undefined} />
      {errSku[llave] && <span className="err" id={llave + '-e'}>{errSku[llave]}</span>}
    </div>
  )

  // --- listas ----------------------------------------------------------
  const visibles = <T extends { activo: boolean }>(xs: T[]) =>
    verInactivos ? xs : xs.filter(x => x.activo)

  function lista(
    que: 'producto' | 'subproducto',
    filas: Fila[], elegido: string, elegir: (id: string) => void,
  ) {
    const mostradas = visibles(filas)
    const ocultas = filas.length - mostradas.length
    return (
      <>
        <ul>
          {mostradas.map(f => (
            <li key={f.id} className={f.activo ? '' : 'inactiva'}>
              <div className={'fila-cat' + (f.id === elegido ? ' on' : '')}>
                <button className="nombre" onClick={() => elegir(f.id)}>
                  {f.nombre}
                  {!f.activo && <em>inactivo</em>}
                </button>
                {editable && (
                  <button className="ed" onClick={() => abrirEdicion(que, f)}
                          aria-label={'Editar ' + f.nombre}>Editar</button>
                )}
              </div>
            </li>
          ))}
        </ul>
        {mostradas.length === 0 && (
          <p className="sinnada">
            {ocultas > 0
              ? `Ninguno activo. Hay ${ocultas} inactivo${ocultas > 1 ? 's' : ''}.`
              : `Sin ${que}s.${editable ? ' Agrega el primero abajo.' : ''}`}
          </p>
        )}
        {editable && (editando === 'nuevo:' + que ? (
          <form className="nuevo" onSubmit={e => guardarFila(e, que)}>
            <input autoFocus value={texto} onChange={e => setTexto(e.target.value)}
                   placeholder={'Nombre del ' + que} aria-label={'Nombre del ' + que} />
            <button>Guardar</button>
            <button type="button" className="x" onClick={cerrarEdicion}
                    aria-label="Cancelar">✕</button>
          </form>
        ) : (
          <footer>
            <button className="agregar" onClick={() => abrirNuevo(que)}>
              + Agregar {que}
            </button>
          </footer>
        ))}
      </>
    )
  }

  const skusVisibles = visibles(skus)

  // --- render ------------------------------------------------------------
  return (
    <>
      <div className="tope">
        <div>
          <h2 className="disp">Catálogo</h2>
          <p>Cliente, producto, subproducto y SKU</p>
        </div>
        <div className="tope-dcha">
          <label className="chk">
            <input type="checkbox" checked={verInactivos}
                   onChange={e => setVerInactivos(e.target.checked)} />
            Ver inactivos
          </label>
          {clientes.length > 1 && (
            <div className="campo" style={{ margin: 0, minWidth: 200 }}>
              <label htmlFor="cl">Cliente</label>
              <select id="cl" value={cliente} onChange={e => setCliente(e.target.value)}>
                {clientes.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
            </div>
          )}
        </div>
      </div>

      {aviso && <div className="aviso error" role="alert">{aviso}</div>}
      {ok && <div className="aviso ok" role="status">{ok}</div>}

      <div className="cols">
        <section className="col">
          <header><h3>Productos</h3><span>{visibles(productos).length}</span></header>
          {lista('producto', productos, producto, setProducto)}
        </section>

        <section className="col">
          <header><h3>Subproductos</h3><span>{producto ? visibles(subs).length : ''}</span></header>
          {!producto
            ? <p className="sinnada">Elige un producto para ver sus subproductos.</p>
            : lista('subproducto', subs, sub, setSub)}
        </section>

        <section className="col">
          <header><h3>SKUs</h3><span>{sub ? skusVisibles.length : ''}</span></header>
          {!sub ? (
            <p className="sinnada">Elige un subproducto para ver sus SKUs.</p>
          ) : (
            <>
              <div style={{ overflowX: 'auto', flex: 1 }}>
                <table className="skus">
                  <thead>
                    <tr>
                      <th>Código</th><th>Nombre</th><th>Barras</th>
                      <th className="der">Sugerido</th>
                      {editable && <th className="col-ed"></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {skusVisibles.map(k => (
                      <tr key={k.id} className={k.activo ? '' : 'inactiva'}>
                        <td className="num">
                          <b>{k.codigo}</b>
                          {!k.activo && <em className="marca-inactivo">inactivo</em>}
                        </td>
                        <td>{k.nombre}</td>
                        <td className="num">{k.codigo_barras ?? '—'}</td>
                        <td className="num der">{pesos(k.precio_sugerido)}</td>
                        {editable && (
                          <td className="col-ed">
                            <button className="ed" onClick={() => abrirSkuEdicion(k)}
                                    aria-label={'Editar SKU ' + k.codigo}><IcoLapiz /></button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {skusVisibles.length === 0 && (
                  <p className="sinnada">
                    {skus.length > 0
                      ? `Ninguno activo. Hay ${skus.length} inactivo${skus.length > 1 ? 's' : ''}.`
                      : 'Sin SKUs en este subproducto.'}
                  </p>
                )}
              </div>
              {editable && (
                <footer>
                  <button className="agregar" onClick={abrirSkuNuevo}>+ Agregar SKU</button>
                </footer>
              )}
            </>
          )}
        </section>
      </div>

      {enEdicion && (
        <>
          <div className="velo" onClick={cerrarEdicion} />
          <div className="panel" role="dialog" aria-modal="true"
               aria-label={'Editar ' + queEdita}>
            <h3>Editar {queEdita}</h3>
            <form onSubmit={e => guardarFila(e, queEdita, idEdita)}>
              {aviso && <div className="aviso error" role="alert">{aviso}</div>}
              <div className="campo">
                <label htmlFor="f-nombre">Nombre</label>
                <input id="f-nombre" autoFocus value={texto}
                       onChange={e => setTexto(e.target.value)} />
              </div>
              <label className="chk" style={{ marginBottom: 6 }}>
                <input type="checkbox" checked={activoEd}
                       onChange={e => setActivoEd(e.target.checked)} />
                Activo
              </label>
              <p className="nota-panel">
                Al desactivarlo deja de ofrecerse en formularios nuevos.
                Las visitas que ya lo capturaron no se tocan.
              </p>
              <div className="dos" style={{ marginTop: 6 }}>
                <button type="button" className="btn sec" onClick={cerrarEdicion}>
                  Cancelar
                </button>
                <button className="btn">Guardar</button>
              </div>
            </form>
          </div>
        </>
      )}

      {panelSku && (
        <>
          <div className="velo" onClick={() => setPanelSku(false)} />
          <div className="panel" role="dialog" aria-modal="true"
               aria-label={skuEditando ? 'Editar SKU' : 'Nuevo SKU'}>
            <h3>{skuEditando ? 'Editar SKU' : 'Nuevo SKU'}</h3>
            <form onSubmit={guardarSku} noValidate>
              {aviso && <div className="aviso error" role="alert">{aviso}</div>}
              {campoSku('codigo', 'Código')}
              {campoSku('nombre', 'Nombre')}
              {campoSku('codigo_barras', 'Código de barras')}
              {campoSku('precio_sugerido', 'Precio sugerido (MXN)', 'number')}

              {skuEditando && (
                <>
                  <label className="chk" style={{ marginBottom: 6 }}>
                    <input type="checkbox" checked={formSku.activo}
                           onChange={e => setFormSku({ ...formSku, activo: e.target.checked })} />
                    Activo
                  </label>
                  <p className="nota-panel">
                    Al desactivarlo deja de ofrecerse en formularios nuevos.
                    Las visitas que ya lo capturaron no se tocan.
                  </p>
                </>
              )}

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
