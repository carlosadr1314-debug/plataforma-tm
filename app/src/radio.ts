// =====================================================================
// La regla del check-in
//
// Vive aparte de la pantalla por dos razones: es lo que mas se va a
// discutir con el cliente, y asi se puede probar sin levantar React
// Native. Este archivo no importa nada a proposito.
// =====================================================================

// Metros de gracia por encima del radio de la tienda, ya descontado el
// margen de error del GPS. Suena a poquisimo y lo seria si se comparara
// la distancia pelona; no es esa la que se compara.
//
// La perilla de verdad es el radio de cada tienda, que se captura una
// por una. Si en una tienda los promotores se topan seguido con el
// bloqueo, lo que esta mal es su radio, no esta tolerancia.
export const TOLERANCIA_M = 20

/**
 * En que zona cae una medicion. Se compara la distancia MENOS el margen
 * de error del GPS: "¿aun en el mejor de los casos sigue lejos?".
 * Esta aqui aparte porque es la regla que mas se va a discutir, y asi
 * se puede probar sin levantar la pantalla.
 */
export function zonaDeCheckin(metros: number, margen: number, radio: number) {
  const masCerca = Math.max(0, metros - Math.max(0, margen))
  if (masCerca <= radio) return 'dentro' as const
  if (masCerca <= radio + TOLERANCIA_M) return 'cerca' as const
  return 'bloqueado' as const
}
