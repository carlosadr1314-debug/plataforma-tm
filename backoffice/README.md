# Backoffice — consola de administración

React + Vite + TypeScript. CSS propio, sin framework de estilos.

## Configuración

    cp .env.local.example .env.local
    # llenar con Project Settings > API de Supabase
    npm run dev

Abre http://localhost:5173

## Estructura

- `src/lib/supabase.ts` — cliente
- `src/lib/sesion.tsx` — sesión y permisos del perfil
- `src/componentes/` — layout e iconos
- `src/paginas/` — pantallas

## Diseño

Tokens en `src/estilos.css`. Paleta y tipografía vienen del mockup
aprobado: azul control, naranja de anaquel, arena. Barlow Condensed
para display, Inter para texto. El naranja nunca lleva texto blanco.
