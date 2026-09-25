# Plataforma de trade marketing — Apatayana

Gestion de equipo de campo: itinerarios, captura de visitas en punto
de venta con verificacion por GPS y evidencia fotografica, y reportes.

## Estructura

- `db/migrations` — esquema. Un archivo por cambio, numerado. Los
  anteriores nunca se editan.
- `db/seed` — datos de prueba para desarrollo.
- `db/tests` — pruebas de aislamiento y politicas de seguridad.
- `app` — aplicacion movil del promotor (React Native / Expo).
- `backoffice` — consola web de administracion (React).
- `docs` — levantamiento, alcance, minutas.
- `diseno` — propuestas visuales.

## Reglas

- Nunca subir `.env`, llaves, keystores ni certificados.
- El aislamiento entre clientes vive en las politicas RLS de
  PostgreSQL, no en el codigo. Toda tabla nueva lleva su politica en
  la misma migracion que la crea.
- La llave `service_role` ignora esas politicas. Solo en servidor.

## Propiedad

Codigo y datos propiedad de Apatayana Agencia de Mkt.
