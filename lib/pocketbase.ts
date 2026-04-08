// lib/pocketbase.ts
const PB_URL = process.env.NEXT_PUBLIC_POCKETBASE_URL || "http://127.0.0.1:8090"
const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://172.16.10.31"

export interface TintaData {
  pantone: string
  tinta: string
  anilox: number
  bcm: number
  densidad: number
  precio: number
}

export interface KgPorColor {
  color: string
  tinta: string
  bcm: number
  densidad: number
  cobertura: number
  kgBruto: number    // ← agregar
  kgTinta: number
  kgDisolvente: number
  anilox: number
}

export interface CatalogoMaquina {
  id: string
  codigo: string
  nombre: string
}

export const TRANSFERENCIA = 0.3
export const DILUCION = 0.1

// Quita el prefijo "PANTONE " y espacios extra
function limpiarNombrePantone(nombre: string): string {
  return nombre
    .replace(/^PANTONE\s+/i, "")
    .trim()
}

// Jala colores del endpoint .NET (fuente de verdad)
async function getColoresDesdeAPI(printCard: string): Promise<{ pantone: string, cobertura: number, orden: number }[]> {
  try {
    const res = await fetch(`${API_URL}/api/PrintCardTintas/${encodeURIComponent(printCard)}`)
    if (!res.ok) return []
    return await res.json()
  } catch (e) {
    console.error("Error fetching colores desde API:", e)
    return []
  }
}

// Busca BCM, anilox y densidad en PocketBase por nombre de Pantone
export async function getTinta(nombre: string): Promise<TintaData | null> {
  try {
    const limpio = limpiarNombrePantone(nombre)
    const encoded = encodeURIComponent(limpio)
    // ~ es LIKE case-insensitive en PocketBase
    const res = await fetch(
      `${PB_URL}/api/collections/tintas/records?filter=(pantone~'${encoded}'||tinta~'${encoded}')&perPage=1`
    )
    if (!res.ok) return null
    const data = await res.json()
    if (!data.items?.length) return null

    const item = data.items[0]
    return {
      ...item,
      anilox: parseFloat(item.anilox) || 0,
      bcm: parseFloat(item.bcm) || 0,
      densidad: parseFloat(item.densidad) || 0,
      precio: parseFloat(item.precio) || 0,
    } as TintaData
  } catch (e) {
    console.error("Error fetching tinta:", e)
    return null
  }
}

// Flujo híbrido: colores de .NET + BCM/anilox/densidad de PocketBase
export async function getPrintCardHibrido(
  printCard: string,
  metros: number,
  anchoCm: number,
  kgBase: number
): Promise<KgPorColor[]> {
  const coloresAPI = await getColoresDesdeAPI(printCard)
  if (!coloresAPI.length) return []

  const resultados: KgPorColor[] = []

  for (const colorRow of coloresAPI) {
    if (!colorRow.pantone) continue
    const cobertura = (colorRow.cobertura || 0) / 100  // viene en % , convertir a decimal

    const tinta = await getTinta(colorRow.pantone)
    const bcm = tinta?.bcm ?? 0
    const densidad = tinta?.densidad ?? 0
    const anilox = tinta?.anilox ?? 0

    const { kgTinta, kgDisolvente } = calcularKgPorColor(
      metros, anchoCm, bcm, densidad, cobertura, kgBase
    )

    resultados.push({
      color: colorRow.pantone,
      tinta: tinta?.tinta ?? limpiarNombrePantone(colorRow.pantone),
      bcm,
      densidad,
      cobertura,
      kgBruto: kgTinta,  // ← agregar esto
      kgTinta,
      kgDisolvente,
      anilox,
    })
  }

  return resultados
}

export function calcularKgPorColor(
  metros: number,
  anchoCm: number,
  bcm: number,
  densidad: number,
  cobertura: number,
  kgBase: number = 0,
  kgEnMaquina: number = 0
): { kgBruto: number; kgTinta: number; kgDisolvente: number } {
  if (!bcm || !densidad || !anchoCm) return { kgBruto: 0, kgTinta: 0, kgDisolvente: 0 }
  const m2 = metros * anchoCm / 100
  const pctTinta = 1 / (1 + DILUCION)
  const pctDisolvente = DILUCION / (1 + DILUCION)
  const base = (m2 * bcm * densidad / 1000) * cobertura * TRANSFERENCIA
  const kgBruto = Math.round((base * pctTinta + kgBase) * 100) / 100  // ← sin restar kgEnMaquina
  const kgTinta = Math.max(0, kgBruto - kgEnMaquina)                   // ← lo que hay que pedir
  const kgDisolvente = base * pctDisolvente
  return {
    kgBruto: Math.round(kgBruto * 100) / 100,
    kgTinta: Math.round(kgTinta * 100) / 100,
    kgDisolvente: Math.round(kgDisolvente * 100) / 100,
  }
}

export function calcularTiempoPorTinta(
  kgEnMaquina: number,
  velocidad: number,
  anchoCm: number,
  bcm: number,
  densidad: number,
  cobertura: number,
): number {
  if (!velocidad || !bcm || !densidad || !anchoCm || !kgEnMaquina) return 999
  const pctTinta = 1 / (1 + DILUCION)
  const consumoPorMetro = (anchoCm / 100 * bcm * densidad / 1000) * cobertura * TRANSFERENCIA * pctTinta
  if (!consumoPorMetro) return 999
  const consumoPorMinuto = consumoPorMetro * velocidad
  return Math.round(kgEnMaquina / consumoPorMinuto)
}

export async function getPrintCard(printCard: string) {
  try {
    const res = await fetch(
      `${PB_URL}/api/collections/print_cards/records?filter=(print_card='${encodeURIComponent(printCard)}')&perPage=1`
    )
    if (!res.ok) return null
    const data = await res.json()
    if (!data.items?.length) return null
    const r = data.items[0]
    return {
      print_card: r.print_card,
      producto: r.producto,
      ancho: parseFloat(r.ancho) || 0,
      maquina: r.maquina || "",
      colores: [] as string[],
      coberturas: [] as number[],
    }
  } catch (e) {
    console.error("Error fetching print card:", e)
    return null
  }
}

function normalizarCodigoMaquina(value: string): string | null {
  const match = value.match(/\bI?(\d{1,2})\b/i)
  if (!match?.[1]) return null
  return match[1].padStart(2, "0")
}

export async function getMaquinasCatalogo(): Promise<CatalogoMaquina[]> {
  try {
    const perPage = 500
    let page = 1
    let totalPages = 1
    const maquinas = new Map<string, CatalogoMaquina>()

    while (page <= totalPages) {
      const res = await fetch(
        `${PB_URL}/api/collections/print_cards/records?fields=maquina&perPage=${perPage}&page=${page}`
      )

      if (!res.ok) return []

      const data = await res.json()
      totalPages = Number(data.totalPages ?? 1)

      for (const item of data.items ?? []) {
        const nombre = String(item.maquina ?? "").trim()
        const codigo = normalizarCodigoMaquina(nombre)
        if (!nombre || !codigo || maquinas.has(codigo)) continue

        maquinas.set(codigo, {
          id: `bobst-${codigo}`,
          codigo,
          nombre: `Prensa ${codigo}`,
        })
      }

      page += 1
    }

    return [...maquinas.values()].sort((a, b) => a.codigo.localeCompare(b.codigo))
  } catch (e) {
    console.error("Error fetching catalogo de maquinas:", e)
    return []
  }
}
