// =====================================================================
// Funcion de borde: crear-cuenta
//
// Crear una cuenta de acceso exige la llave de servicio, que pasa por
// encima de todo el aislamiento. Esa llave no puede vivir en el
// navegador: cualquiera que abra las herramientas de desarrollador se
// quedaria con la base entera. Por eso existe esto, que corre en los
// servidores de Supabase.
//
// REGLA DE DISENO
// La llave de servicio se usa SOLO para crear la cuenta de acceso.
// Todo lo demas —la fila en usuario, los clientes asignados— se
// escribe con las credenciales de quien llama, para que las politicas
// de la base sigan decidiendo. Esta funcion no reimplementa los
// permisos: los pide prestados.
//
// Si algo falla despues de crear la cuenta, la cuenta se borra. Mejor
// nada que una cuenta huerfana sin empresa.
// =====================================================================

import { createClient } from 'npm:@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const responder = (cuerpo: unknown, estado = 200) =>
  new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })

const fallo = (mensaje: string, estado = 400) => responder({ error: mensaje }, estado)

// Contrasena que nadie va a ver ni usar: la cuenta nace con ella y la
// persona la reemplaza al abrir su enlace. Evita que quien da de alta
// conozca la clave de nadie.
const claveDesechable = () =>
  crypto.randomUUID().replace(/-/g, '') + 'Aa1!'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return fallo('Método no permitido', 405)

  const URL = Deno.env.get('SUPABASE_URL')
  const ANON = Deno.env.get('SUPABASE_ANON_KEY')
  const SERVICIO = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ??
                   Deno.env.get('LLAVE_SERVICIO')
  if (!URL || !ANON || !SERVICIO) {
    return fallo(
      'Falta la llave de servicio en la configuración de la función. ' +
      'Agrégala en Edge Functions > Secrets con el nombre LLAVE_SERVICIO.', 500)
  }

  const autorizacion = req.headers.get('Authorization')
  if (!autorizacion) return fallo('Falta iniciar sesión', 401)

  // Cliente que actua COMO QUIEN LLAMA: las politicas aplican igual
  // que si escribiera desde la pantalla.
  const comoUsuario = createClient(URL, ANON, {
    global: { headers: { Authorization: autorizacion } },
    auth: { persistSession: false },
  })

  // Cliente con la llave de servicio. Solo para crear y borrar
  // cuentas de acceso; para nada mas.
  const admin = createClient(URL, SERVICIO, { auth: { persistSession: false } })

  const { data: quien } = await comoUsuario.auth.getUser()
  if (!quien?.user) return fallo('La sesión no es válida', 401)

  let cuerpo: any
  try { cuerpo = await req.json() } catch { return fallo('El cuerpo no es JSON válido') }

  // A donde vuelve la persona al abrir el enlace. Lo manda la pantalla
  // que llama, asi el mismo codigo sirve en local y en produccion sin
  // tener que cambiar la configuracion de Supabase cada vez.
  const destino = typeof cuerpo?.regresar_a === 'string' && cuerpo.regresar_a.startsWith('http')
    ? { redirectTo: cuerpo.regresar_a as string }
    : undefined

  const tipo = cuerpo?.tipo
  const TIPOS = ['promotor', 'persona', 'cuenta_empresa', 'enlace_contrasena', 'cambiar_nip']
  if (!TIPOS.includes(tipo)) return fallo('Tipo no reconocido: ' + tipo)

  // ===================================================================
  // A) Cuenta suelta para el administrador de una empresa nueva.
  //    No lleva fila en usuario: de eso se encarga alta_empresa().
  // ===================================================================
  if (tipo === 'cuenta_empresa') {
    const { data: esSuper } = await comoUsuario.rpc('es_superadmin')
    if (esSuper !== true) {
      return fallo('Solo un administrador de plataforma puede crear estas cuentas', 403)
    }

    const correo = String(cuerpo.correo ?? '').trim().toLowerCase()
    if (!correo.includes('@')) return fallo('Escribe un correo completo')

    const { data: creada, error } = await admin.auth.admin.createUser({
      email: correo, password: claveDesechable(), email_confirm: true,
    })
    if (error) return fallo(traducir(error.message))

    const { data: enlace } = await admin.auth.admin.generateLink({
      type: 'recovery', email: correo, options: destino,
    })
    return responder({
      id: creada.user.id, correo, enlace: enlace?.properties?.action_link,
    })
  }

  // ===================================================================
  // C) Enlace para que la persona ponga su propia contrasena
  //
  //    Nadie necesita conocer la contrasena de nadie. Se genera un
  //    enlace de un solo uso y se le pasa por donde sea; al abrirlo,
  //    la persona elige su clave. Quien la da de alta nunca la sabe,
  //    y sirve igual para el caso de "se me olvido".
  // ===================================================================
  if (tipo === 'enlace_contrasena') {
    const { data: esSuper } = await comoUsuario.rpc('es_superadmin')
    let correo = ''

    if (esSuper === true && cuerpo.correo) {
      // El administrador de plataforma puede generarlo para el
      // responsable de cualquier empresa.
      correo = String(cuerpo.correo).trim().toLowerCase()
    } else {
      const { data: puedeU } = await comoUsuario.rpc('puede_gestionar_usuarios')
      if (puedeU !== true) {
        return fallo('Tu perfil no tiene permiso para esto', 403)
      }
      // correo_de_usuario() devuelve nulo si esa persona es de otra
      // empresa. La restriccion vive en la base, no en esta funcion.
      const { data: c } = await comoUsuario.rpc('correo_de_usuario',
        { p_usuario: cuerpo.usuario_id })
      if (!c) return fallo('Esa persona no es de tu empresa', 403)
      correo = String(c)
      if (correo.endsWith('.promotor.local')) {
        return fallo('Los promotores no tienen correo. Cámbiale el NIP en su lugar.')
      }
    }

    const { data: enlace, error } = await admin.auth.admin.generateLink({
      type: 'recovery', email: correo, options: destino,
    })
    if (error) return fallo(traducir(error.message))
    return responder({ correo, enlace: enlace.properties?.action_link })
  }

  // ===================================================================
  // D) Nuevo NIP de un promotor
  //
  //    El promotor no tiene correo de verdad, asi que no hay enlace
  //    que mandarle: su NIP lo repone quien administra su empresa.
  // ===================================================================
  if (tipo === 'cambiar_nip') {
    const { data: puedeU } = await comoUsuario.rpc('puede_gestionar_usuarios')
    if (puedeU !== true) return fallo('Tu perfil no tiene permiso para esto', 403)

    const nip = String(cuerpo.nip ?? '').trim()
    if (!/^[0-9]{8}$/.test(nip)) return fallo('El NIP debe tener exactamente 8 dígitos')

    const { data: c } = await comoUsuario.rpc('correo_de_usuario',
      { p_usuario: cuerpo.usuario_id })
    if (!c) return fallo('Esa persona no es de tu empresa', 403)
    if (!String(c).endsWith('.promotor.local')) {
      return fallo('Esa cuenta no es de promotor. Mándale un enlace de contraseña.')
    }

    const { error } = await admin.auth.admin.updateUserById(
      String(cuerpo.usuario_id), { password: nip })
    if (error) return fallo(traducir(error.message))
    return responder({ ok: true })
  }

  // ===================================================================
  // B) Alguien del equipo de una empresa
  // ===================================================================
  const { data: puede } = await comoUsuario.rpc('puede_gestionar_usuarios')
  if (puede !== true) {
    return fallo('Tu perfil no tiene permiso para dar de alta usuarios', 403)
  }

  const nombre = String(cuerpo.nombre ?? '').trim()
  const perfil_id = cuerpo.perfil_id
  if (!nombre) return fallo('Escribe el nombre de la persona')
  if (!perfil_id) return fallo('Elige un perfil')

  // La organizacion sale de la fila de quien llama, no de lo que mande
  // el navegador. Si viniera del cuerpo, alguien podria dar de alta
  // gente en otra empresa.
  const { data: yo, error: errYo } = await comoUsuario
    .from('usuario')
    .select('organizacion_id, organizacion:organizacion_id(slug)')
    .eq('id', quien.user.id)
    .maybeSingle()
  if (errYo || !yo) return fallo('No se pudo determinar tu empresa', 403)

  const organizacion_id = (yo as any).organizacion_id
  const slug = (yo as any).organizacion?.slug

  let correo: string
  let clave: string

  if (tipo === 'promotor') {
    const codigo = String(cuerpo.codigo ?? '').trim()
    const nip = String(cuerpo.nip ?? '').trim()
    if (!/^[0-9]{4,10}$/.test(codigo)) {
      return fallo('El código de empleado debe tener entre 4 y 10 dígitos')
    }
    if (!/^[0-9]{8}$/.test(nip)) {
      return fallo('El NIP debe tener exactamente 8 dígitos')
    }
    if (!slug) return fallo('Tu empresa no tiene código asignado')
    // Convencion fija: la aplicacion arma este mismo correo a partir
    // del codigo de empresa y el codigo de empleado. El promotor no
    // ve un correo nunca.
    correo = `${codigo}@${slug}.promotor.local`
    clave = nip
  } else {
    correo = String(cuerpo.correo ?? '').trim().toLowerCase()
    if (!correo.includes('@')) return fallo('Escribe un correo completo')
    clave = claveDesechable()
  }

  const { data: creada, error: errCuenta } = await admin.auth.admin.createUser({
    email: correo, password: clave, email_confirm: true,
  })
  if (errCuenta) return fallo(traducir(errCuenta.message))

  const nuevoId = creada.user.id

  // De aqui en adelante, si algo falla, se deshace la cuenta.
  const deshacer = async (mensaje: string, estado = 400) => {
    await admin.auth.admin.deleteUser(nuevoId)
    return fallo(mensaje, estado)
  }

  const { error: errFila } = await comoUsuario.from('usuario').insert({
    id: nuevoId,
    organizacion_id,
    perfil_id,
    nombre,
    telefono: cuerpo.telefono ? String(cuerpo.telefono).trim() : null,
    region_id: cuerpo.region_id || null,
    es_promotor: tipo === 'promotor',
    codigo: tipo === 'promotor' ? String(cuerpo.codigo).trim() : null,
  })
  if (errFila) {
    return deshacer(
      errFila.code === '23505'
        ? 'Ya existe alguien con ese código de empleado en tu empresa'
        : errFila.code === '42501'
        ? 'Las reglas de la base rechazaron el alta. Revisa tu permiso.'
        : 'No se pudo guardar la ficha. ' + errFila.message)
  }

  const clientes: string[] = Array.isArray(cuerpo.clientes) ? cuerpo.clientes : []
  if (clientes.length) {
    const { error: errCl } = await comoUsuario.from('usuario_cliente')
      .insert(clientes.map((cliente_id) => ({ usuario_id: nuevoId, cliente_id })))
    if (errCl) {
      await comoUsuario.from('usuario').delete().eq('id', nuevoId)
      return deshacer('No se pudieron asignar los clientes. ' + errCl.message)
    }
  }

  // El promotor recibe su NIP de viva voz. Quien tiene correo recibe
  // un enlace y elige su propia contrasena.
  let enlace: string | undefined
  if (tipo === 'persona') {
    const { data: e } = await admin.auth.admin.generateLink({
      type: 'recovery', email: correo, options: destino,
    })
    enlace = e?.properties?.action_link
  }

  return responder({
    id: nuevoId,
    correo,
    enlace,
    acceso: tipo === 'promotor'
      ? { codigo_empresa: slug, codigo_empleado: cuerpo.codigo }
      : { correo },
  })
})

function traducir(m: string) {
  const b = m.toLowerCase()
  if (b.includes('already registered') || b.includes('already been registered')) {
    return 'Ese correo o código ya tiene una cuenta'
  }
  if (b.includes('password')) {
    return 'La contraseña no cumple lo que exige el proyecto. ' +
           'Si pide letras o símbolos, un NIP de puros números se rechaza: ' +
           'revisa Authentication > Policies en Supabase.'
  }
  return m
}
