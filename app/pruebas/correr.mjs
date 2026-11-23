// Corre las pruebas sin instalar nada: Node 22 ejecuta TypeScript solo,
// y los ganchos de resolucion cambian AsyncStorage y Supabase por los
// dobles de pruebas/dobles.
import { register } from 'node:module'
register('./ganchos.mjs', import.meta.url)
await import('./sinSenal.prueba.ts')
await import('./zonaCheckin.prueba.ts')
await import('./reglasFormulario.prueba.ts')
await import('./fotos.prueba.ts')
