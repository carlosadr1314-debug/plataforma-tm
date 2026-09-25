# Guía de instalación de la base de datos

Plataforma de trade marketing — Apatayana

---

## Por qué Supabase

| Necesidad del proyecto | Qué lo resuelve |
|---|---|
| Aislar 100 marcas entre sí | Row Level Security de PostgreSQL, en la base, no en el código |
| Catálogo de 4 niveles con relaciones | PostgreSQL relacional |
| Almacenar de 1 a 20 fotos por visita | Storage integrado con políticas de acceso |
| Login de promotores y backoffice | Auth integrado, ligado a las políticas de seguridad |
| Sincronización desde la app | API REST autogenerada sobre cada tabla |
| Empezar con lo básico | Capa gratuita para desarrollo |

Lo decisivo es el primer punto. Con acceso de administrador para el cliente final, un error en una consulta del backoffice podría exponer datos de una marca a otra. Con RLS eso es imposible: la restricción vive en el motor de base de datos y aplica incluso si el código se equivoca.

---

## Paso 1 — Crear el proyecto

1. Entra a supabase.com y crea una cuenta.
2. New project. Nombre sugerido: `apatayana-trademarketing`.
3. Región: la más cercana a México entre las disponibles en Estados Unidos.
4. Genera la contraseña de base de datos y **guárdala en tu gestor de contraseñas**. Supabase no la vuelve a mostrar y la necesitarás para conectarte por fuera del panel.
5. Espera a que termine el aprovisionamiento.

---

## Paso 2 — Crear el esquema

1. Abre **SQL Editor** en el menú lateral.
2. New query.
3. Pega el contenido completo de `06-esquema-supabase-v2.sql`.
4. Ejecuta.

Debe terminar sin errores. Verifica en **Table Editor** que aparezcan las tablas: agencia, cliente, region, perfil, usuario, producto, subproducto, sku, cadena, pdv, formulario, pregunta, condicion_pregunta, tarea, itinerario, visita, respuesta, evidencia, comunicado y sesion_app.

---

## Paso 3 — Storage y triggers

1. Nueva consulta en SQL Editor.
2. Pega y ejecuta `08-storage-y-politicas.sql`.

Esto crea el bucket privado `evidencia`, sus políticas de acceso y los disparadores que impiden modificar una visita ya cerrada.

Revisa en **Storage** que el bucket exista y que **no** esté marcado como público.

---

## Paso 4 — Crear los usuarios de prueba

En **Authentication → Users → Add user**, crea estos cuatro con la opción de autoconfirmar activada:

| Correo | Rol que representa |
|---|---|
| admin@apatayana.test | Administrador raíz |
| cliente@televia.test | Cliente final con permisos de administrador |
| supervisor@apatayana.test | Supervisor de región |
| promotor@apatayana.test | Promotor de campo |

Usa una contraseña que recuerdes; son cuentas desechables de desarrollo.

---

## Paso 5 — Cargar datos de prueba

1. Nueva consulta en SQL Editor.
2. Pega y ejecuta `09-datos-de-prueba.sql`.

Al final del archivo hay cuatro consultas de verificación. Deben devolver:

- El catálogo bajando los cuatro niveles hasta SKU.
- La pregunta condicional enlazada a la pregunta de la que depende.
- Dos visitas programadas al mismo punto de venta en la misma fecha.

Las dos últimas instrucciones están comentadas a propósito: son pruebas que **deben fallar**. Descoméntalas una por una para confirmar que la protección del administrador raíz funciona.

---

## Paso 6 — Probar el aislamiento

Esta es la prueba que realmente importa. Crea un segundo cliente y confirma que un usuario sin acceso a él no lo ve.

```sql
-- Como administrador, crea una segunda marca
insert into cliente (agencia_id, nombre)
values ('11111111-1111-1111-1111-111111111111', 'Marca de prueba');
```

Luego, desde la aplicación o desde la API con el token del promotor, consulta la tabla `cliente`. Debe devolver únicamente Televia, porque el promotor no tiene fila en `usuario_cliente` para la marca nueva.

**Importante:** el SQL Editor del panel ejecuta con llave de servicio y **omite las políticas RLS**. Nunca pruebes el aislamiento desde ahí; siempre con un token de usuario real.

---

## Paso 7 — Guardar las credenciales

En **Project Settings → API** encontrarás:

| Credencial | Dónde va |
|---|---|
| Project URL | App y backoffice |
| anon public key | App y backoffice. Es segura de exponer porque RLS la limita |
| service_role key | Sólo servidor. **Nunca** en la app móvil ni en el navegador |

La llave de servicio ignora todas las políticas de seguridad. Si se filtra, se pierde el aislamiento completo entre clientes.

---

## Paso 8 — Versionar el esquema

Crea el repositorio ahora, no después.

```
apatayana-plataforma/
├── db/
│   ├── 01_esquema.sql
│   ├── 02_storage.sql
│   └── 03_seed.sql
├── app/
└── backoffice/
```

A partir de aquí, cada cambio al esquema es un archivo nuevo numerado, nunca una edición de los anteriores. Cuando la base tenga datos reales, no podrás recrearla desde cero.

---

## Lo que tienes que vigilar: el almacenamiento

Este es el punto que conviene revisar antes de comprometer costos.

Con fotos comprimidas a unos 200 KB:

| Escenario | Fotos por día | Volumen mensual |
|---|---|---|
| 50 promotores, 20 fotos | 1,000 | ~4 GB |
| 500 promotores, 20 fotos | 10,000 | ~40 GB |

La capa gratuita de Supabase incluye 1 GB de Storage. Sirve para desarrollar, no para operar.

Tres consecuencias prácticas:

1. **La compresión en el dispositivo no es opcional.** Es lo que separa 200 KB de 3 MB por foto, o sea la diferencia entre 4 GB y 60 GB al mes.
2. **Se necesita política de retención.** Definir con la organización cuánto tiempo se conserva la evidencia fotográfica. Es una pregunta de negocio, no técnica, y debe entrar al bloque H del levantamiento.
3. **Al crecer conviene separar el almacenamiento.** La base de datos puede quedarse en Supabase mientras las fotos migran a un servicio de objetos más barato. El esquema ya lo permite: `evidencia.storage_path` guarda una ruta, no el archivo.

---

## Siguiente paso

Con la base en pie, lo que sigue es el backoffice: altas de catálogo, puntos de venta y usuarios. Es el requisito 1 del entregable mínimo que definió la organización, y además es lo que permite cargar datos reales para probar la app.
