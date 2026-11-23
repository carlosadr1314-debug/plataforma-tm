import { memo } from 'react'

// =====================================================================
// El horario semanal del promotor
//
// Plantilla, no calendario: lo que le toca cumplir cada dia de la
// semana. Los dias que no trabaja se quedan apagados.
//
// La comida es un solo campo para toda la semana en lugar de uno por
// dia. En campo el tiempo de comida es el mismo todos los dias, y
// siete campos mas serian siete oportunidades de capturar mal. La
// base lo guarda por dia de todos modos, asi que si algun dia hace
// falta variarlo, no hay que migrar nada.
// =====================================================================

export type Dia = { trabaja: boolean; entrada: string; salida: string }

/** Domingo primero, como extract(dow) de Postgres: 0 = domingo. */
export const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles',
                     'Jueves', 'Viernes', 'Sábado']
export const CORTO = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']

export const SEMANA_VACIA = (): Dia[] =>
  DIAS.map(() => ({ trabaja: false, entrada: '09:00', salida: '18:00' }))

/** Minutos entre dos horas "HH:MM". Negativo si la salida es anterior. */
export function minutosEntre(entrada: string, salida: string) {
  const [he, me] = entrada.split(':').map(Number)
  const [hs, ms] = salida.split(':').map(Number)
  if ([he, me, hs, ms].some(n => !Number.isFinite(n))) return 0
  return (hs * 60 + ms) - (he * 60 + me)
}

const horas = (min: number) => {
  const h = Math.floor(min / 60), m = min % 60
  return m === 0 ? `${h} h` : `${h} h ${m} min`
}

function HorarioSemanal({ dias, comida, onDias, onComida }: {
  dias: Dia[]
  comida: number
  onDias: (d: Dia[]) => void
  onComida: (m: number) => void
}) {
  const cambiar = (i: number, parche: Partial<Dia>) =>
    onDias(dias.map((d, j) => (j === i ? { ...d, ...parche } : d)))

  const trabajados = dias.filter(d => d.trabaja)
  const malos = trabajados.filter(d => minutosEntre(d.entrada, d.salida) <= 0)
  const semana = trabajados.reduce(
    (t, d) => t + Math.max(0, minutosEntre(d.entrada, d.salida) - comida), 0)

  return (
    <div className="horario">
      <table className="horario-tabla">
        <thead>
          <tr>
            <th scope="col">Día</th>
            <th scope="col">Entrada</th>
            <th scope="col">Salida</th>
          </tr>
        </thead>
        <tbody>
          {dias.map((d, i) => (
            <tr key={i} className={d.trabaja ? '' : 'libre'}>
              <td>
                <label className="horario-dia">
                  <input type="checkbox" checked={d.trabaja}
                         onChange={e => cambiar(i, { trabaja: e.target.checked })} />
                  <span>{CORTO[i]}</span>
                  <span className="solo-lectores">{DIAS[i]}</span>
                </label>
              </td>
              <td>
                <input type="time" value={d.entrada} disabled={!d.trabaja}
                       aria-label={`Entrada del ${DIAS[i]}`}
                       onChange={e => cambiar(i, { entrada: e.target.value })} />
              </td>
              <td>
                <input type="time" value={d.salida} disabled={!d.trabaja}
                       aria-label={`Salida del ${DIAS[i]}`}
                       onChange={e => cambiar(i, { salida: e.target.value })} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="campo">
        <label htmlFor="h-comida">Tiempo de comida (minutos)</label>
        <input id="h-comida" type="number" min={0} max={240} step={5}
               value={comida}
               onChange={e => onComida(Math.max(0, Math.min(240, Number(e.target.value) || 0)))} />
      </div>

      {malos.length > 0 && (
        <p className="horario-mal">
          {malos.length === 1
            ? 'Hay un día con la salida antes de la entrada. Corrígelo antes de guardar.'
            : `Hay ${malos.length} días con la salida antes de la entrada. Corrígelos antes de guardar.`}
        </p>
      )}

      <p className="nota-panel">
        {trabajados.length === 0
          ? 'Sin días marcados, el promotor no tiene horario que cumplir.'
          : `${trabajados.length} día${trabajados.length === 1 ? '' : 's'} a la semana · ` +
            `${horas(semana)} de trabajo efectivo, ya descontada la comida.`}
      </p>
    </div>
  )
}

export default memo(HorarioSemanal)
