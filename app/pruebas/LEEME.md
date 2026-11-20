# Pruebas de la aplicación

```
cd app
npm run prueba
```

**No hay que instalar nada.** Node 22 ejecuta TypeScript por sí mismo, y
`ganchos.mjs` cambia AsyncStorage y Supabase por los dobles de
`dobles/` en el momento de importar.

Prueban la lógica de trabajar sin señal, que es la que no se puede
verificar a ojo en el teléfono:

- que los cambios de una misma visita se fundan en un solo registro,
  con el estado final y sin perder lo anterior
- que no se pierda nada cuando no hay red
- que todo salga solo cuando la red vuelve
- que un error que **no** es de red se suelte, en vez de dejar la cola
  atorada para siempre reintentando algo que nunca va a pasar
- que la ruta guardada sea sólo la de hoy, porque una de ayer confunde
  más de lo que ayuda

El doble de Supabase tiene un interruptor (`estado.falla`) para simular
que no hay red. Eso permite probar el caso que importa sin apagar el
wifi ni meterse a un sótano.
