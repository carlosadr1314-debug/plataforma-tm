// =====================================================================
// DIRECCION VISUAL
//
// Concepto: tablero de operacion de piso. El promotor trabaja de pie,
// con una mano, bajo mala luz de tienda y con prisa. La pantalla se lee
// de un vistazo a la distancia del brazo: cifras grandes, estado por
// color en el canto de la tarjeta, un solo acento de senalizacion.
//
// Tipografia de dos familias con roles distintos:
//   · Archivo (display) — grotesca de trazo recto, aire de senalizacion
//     y etiqueta de anaquel. Titulos, cifras, codigos de estado.
//   · Inter (texto) — alta legibilidad en pantallas chicas y densidad
//     de pixel baja. Nombres de tienda, direcciones, cuerpo.
//
// Todos los pares de color estan verificados a 4.5:1 o mas.
// =====================================================================

export const c = {
  // Fondo y superficie
  arena:    '#F5F4F1',
  blanco:   '#FFFFFF',
  borde:    '#DFDCD6',

  // Tinta
  tinta:    '#1C1A17',  // 17.4:1 sobre blanco
  tinta2:   '#6B6560',  //  5.7:1 sobre blanco, 5.2:1 sobre arena

  // Marca
  azul:      '#16324F',
  azulSuave: '#E7ECF2',
  azulClaro: '#C9D6E4',  // 8.9:1 sobre azul

  // Acento de senalizacion. El tono vivo es solo para rellenos y
  // cantos; sobre fondo claro el texto usa la version oscura.
  naranja:      '#E8622A',
  naranjaSuave: '#FBE0D3',
  naranjaTexto: '#8A3312',  // 8.2:1 sobre blanco

  // Semanticos, independientes del acento de marca
  exito:       '#1E7A4B',
  exitoSuave:  '#DCEFE4',
  exitoTexto:  '#155635',
  neutro:      '#B8B2AB',
  neutroSuave: '#EAE7E2',
  neutroTexto: '#5A554F',
  error:       '#C0392B',
  errorSuave:  '#F7DEDB',
  errorBorde:  '#E8BDB7',
  errorTexto:  '#8E2A20',
}

export const f = {
  display:     'Archivo_700Bold',
  displaySemi: 'Archivo_600SemiBold',
  texto:       'Inter_400Regular',
  textoMedio:  'Inter_500Medium',
  textoFuerte: 'Inter_700Bold',
}

// Ningun objeto tocable baja de 48 puntos, con 8 de separacion.
export const TOCABLE = 48
export const SEPARACION = 8

// Cifras en columna alineadas
export const CIFRAS = { fontVariant: ['tabular-nums' as const] }
