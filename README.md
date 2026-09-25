# Plataforma de trade marketing

Nombre comercial por definir.

Gestion de equipo de campo para agencias de trade marketing:
itinerarios, captura de visitas en punto de venta con verificacion por
GPS y evidencia fotografica, formularios configurables y reportes.

Producto multi-inquilino: cada organizacion opera con sus propias
marcas, puntos de venta y formularios, aislados de las demas.

## Estructura

- `db/migrations` — esquema. Un archivo por cambio, numerado. Los
  anteriores nunca se editan.
- `db/seed` — datos de prueba para desarrollo.
- `db/tests` — pruebas de aislamiento y politicas de seguridad.
- `app` — aplicacion movil del promotor (React Native / Expo).
- `backoffice` — consola web de administracion (React).
- `docs` — documentacion de producto.
- `diseno` — propuestas visuales.

## Reglas

- Nunca subir `.env`, llaves, keystores ni certificados.
- El aislamiento entre inquilinos vive en las politicas RLS de
  PostgreSQL, no en el codigo. Toda tabla nueva lleva su politica en
  la misma migracion que la crea.
- La llave `service_role` ignora esas politicas. Solo en servidor.
