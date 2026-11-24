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

// Haversine. Para distancias de tienda sobra con la tierra como esfera.
export function metrosEntre(aLat: number, aLng: number, bLat: number, bLng: number) {
  const R = 6371000
  const rad = (g: number) => (g * Math.PI) / 180
  const dLat = rad(bLat - aLat), dLng = rad(bLng - aLng)
  const h = Math.sin(dLat / 2) ** 2 +
            Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2
  return Math.round(2 * R * Math.asin(Math.sqrt(h)))
}

// =====================================================================
// Salirse del radio con la visita en curso
//
// Es otra pregunta que la del check-in y por eso otra regla. Al llegar
// se trata de no dejar pasar a quien no esta ahi; aqui se trata de no
// acusar a quien si esta. Una falsa alarma es cara por partida doble:
// le suena el telefono al promotor sin razon y le deja a la oficina un
// reporte que no paso.
//
// De ahi el colchon mas ancho que la tolerancia del check-in, y la
// histeresis: declarar que se fue pide estar seguro, declarar que
// volvio pide menos. Sin eso, un promotor parado justo en el borde
// generaria una alerta por minuto.
// =====================================================================

export const COLCHON_SALIDA_M = 50

/**
 * Si hay que considerarlo fuera del radio. estabaFuera es lo que se
 * creia hasta el punto anterior: de ahi sale la histeresis.
 */
export function sigueFuera(
  metros: number, margen: number, radio: number, estabaFuera: boolean,
): boolean {
  const m = Math.max(0, margen)
  if (!estabaFuera) {
    // Para decir que se fue: aun en el mejor de los casos esta lejos,
    // y ademas pasado el colchon.
    return metros - m > radio + COLCHON_SALIDA_M
  }
  // Para decir que volvio basta con que PUEDA estar dentro.
  return metros - m > radio
}
