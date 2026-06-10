import type { Impresora, TrabajoActual } from "@/lib/mock-data"
import type { CatalogoMaquina } from "@/lib/pocketbase"
import type { TintasDTO } from "@/lib/tablero-hub"

function parseNumber(value: string): number | null {
  const normalized = value.replace(/,/g, "")
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

export function normalizePrensaCode(value?: string | null): string | null {
  if (!value) return null
  const onlyDigits = value.replace(/\D/g, "")
  if (!onlyDigits) return null
  return onlyDigits.padStart(2, "0")
}

export function parseCantidadPorUnidad(
  value: string,
  unit: "KGM" | "MTR"
): number | null {
  const regex = new RegExp(`([\\d.,]+)\\s*${unit}`, "i")
  const match = value.match(regex)
  if (!match?.[1]) return null
  return parseNumber(match[1])
}

export function prensaToMachineId(prensa: string): string {
  const normalized = normalizePrensaCode(prensa) ?? "00"
  return `bobst-${normalized}`
}

export function machineIdToPrensa(machineId: string): string | null {
  return normalizePrensaCode(machineId)
}

export function tintasToImpresoras(rows: TintasDTO[]): Impresora[] {
  const grouped = rows.reduce<Record<string, TintasDTO[]>>((acc, row) => {
    const prensa = normalizePrensaCode(row.prensa)
    if (!prensa) return acc
    if (!acc[prensa]) acc[prensa] = []
    acc[prensa].push(row)
    return acc
  }, {})

  return Object.entries(grouped)
    .map(([prensa, trabajos]) => {
      const row = trabajos[0]
      const metrosTotales = row.metrosSolicitados
      const metrosRestantes = row.metrosFaltantes
      const porcentaje = Number.isFinite(row.porcentaje) ? row.porcentaje : 0

      const trabajoActual: TrabajoActual = {
        ordenProduccion: row.orden,
        producto: row.producto,
        printCard: row.printCard,
        metrosTotales: metrosTotales > 0 ? metrosTotales : Math.max(metrosRestantes, 1),
        metrosRestantes,
        porcentaje,
        velocidadActual: 0,
        anchoImpresion: 0,
      }

      return {
        id: prensaToMachineId(prensa),
        nombre: `Prensa ${prensa}`,
        estado: porcentaje >= 100 ? "cambio" : "activa",
        sistema: "tradicional",
        trabajoActual,
        cuerpos: [],
        solicitudesPendientes: trabajos.length,
        tieneNotificacion: false,
      } satisfies Impresora
    })
    .sort((a, b) => a.nombre.localeCompare(b.nombre))
}

export function mergeCatalogoConHub(
  catalogo: CatalogoMaquina[],
  rows: TintasDTO[]
): Impresora[] {
  const impresorasHub = tintasToImpresoras(rows)
  const hubPorCodigo = new Map(
    impresorasHub.map((impresora) => [normalizePrensaCode(impresora.id), impresora] as const)
  )

  for (const maquina of catalogo) {
    if (hubPorCodigo.has(maquina.codigo)) continue

    hubPorCodigo.set(maquina.codigo, {
      id: maquina.id,
      nombre: maquina.nombre,
      estado: "parada",
      sistema: "tradicional",
      trabajoActual: null,
      cuerpos: [],
      solicitudesPendientes: 0,
      tieneNotificacion: false,
    })
  }

  return [...hubPorCodigo.values()].sort((a, b) => a.nombre.localeCompare(b.nombre))
}
