// lib/pocketbase.ts
const PB_URL = process.env.NEXT_PUBLIC_POCKETBASE_URL || "http://127.0.0.1:8090"
const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://172.16.10.31"

export interface TintaData {
  pantone: string
  tinta: string
  anilox: number
  bcm: number
  densidad: number
  cobertura: number
  precio: number
}

export interface KgPorColor {
  color: string
  tinta: string
  bcm: number
  densidad: number
  cobertura: number
  kgConsumo: number
  kgBase: number
  kgBruto: number
  kgTinta: number
  kgDisolvente: number
  anilox: number
}

export interface CatalogoMaquina {
  id: string
  codigo: string
  nombre: string
  kgBase?: number
}

export interface AniloxCatalogo {
  lpi: number
  bcm: number
}

export interface PrintCardData {
  id?: string
  print_card: string
  producto: string
  ancho: number
  maquina: string
  colores: string[]
  coberturas: number[]
}

export async function getAniloxCatalogo(): Promise<AniloxCatalogo[]> {
  try {
    const res = await fetch(
      `${PB_URL}/api/collections/anilox/records?sort=lpi&perPage=200`
    )
    if (!res.ok) return []
    const data = await res.json()
    return (data.items ?? []).map((item: Record<string, unknown>) => ({
      lpi: parseFloat(String(item.lpi ?? "0")) || 0,
      bcm: parseFloat(String(item.bcm ?? "0")) || 0,
    }))
  } catch (e) {
    console.error("Error fetching anilox catalog:", e)
    return []
  }
}

export const TRANSFERENCIA = 0.3
export const DILUCION = 0.1
export const BCM_A_CM3_M2 = 1.55

export function normalizarCobertura(value: unknown): number {
  const cobertura = parseFloat(String(value ?? "0")) || 0
  return cobertura > 1 ? cobertura / 100 : cobertura
}

function getCoberturaFromRecord(item: Record<string, unknown>): number {
  return normalizarCobertura(
    item.cobertura ??
    item.porcentaje_cobertura ??
    item.porcentajeCobertura ??
    item.superficie_porcentaje ??
    item.superficiePorcentaje ??
    item.porcentaje ??
    item.coverage
  )
}

// Quita el prefijo "PANTONE " y espacios extra
function limpiarNombrePantone(nombre: string): string {
  return nombre
    .replace(/^PANTONE\s+/i, "")
    .trim()
}

function normalizarNombreBusquedaPantone(nombre: string): string {
  return limpiarNombrePantone(nombre)
    .replace(/\s+/g, " ")
    .trim()
}

function normalizarPantoneComparable(nombre: string): string {
  return limpiarNombrePantone(nombre)
    .replace(/\bCIAN\b/gi, "CYAN")
    .replace(/\s+/g, "")
    .toUpperCase()
}

function escapePocketBaseString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")
}

function buildTintaFilter(terminos: string[]): string {
  const filtros = terminos
    .map((termino) => {
      const value = escapePocketBaseString(termino)
      return `(pantone~'${value}'||tinta~'${value}')`
    })
    .join("||")
  return encodeURIComponent(`(${filtros})`)
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
    const limpio = normalizarNombreBusquedaPantone(nombre)
    const original = nombre.trim().replace(/\s+/g, " ")
    const compacto = limpio.replace(/\s+/g, "")
    const terminos = [...new Set([limpio, original, compacto].filter(Boolean))]
    // ~ es LIKE case-insensitive en PocketBase
    const res = await fetch(
      `${PB_URL}/api/collections/tintas/records?filter=${buildTintaFilter(terminos)}&perPage=10`
    )
    if (!res.ok) return null
    const data = await res.json()
    if (!data.items?.length) return null

    const nombreNormalizado = normalizarPantoneComparable(nombre)
    const item = (data.items as Record<string, unknown>[]).find((record) => {
      const pantone = normalizarPantoneComparable(String(record.pantone ?? ""))
      const tinta = normalizarPantoneComparable(String(record.tinta ?? ""))
      return pantone === nombreNormalizado || tinta === nombreNormalizado
    }) ?? data.items[0]

    return {
      ...item,
      anilox: parseFloat(item.anilox) || 0,
      bcm: parseFloat(item.bcm) || 0,
      densidad: parseFloat(item.densidad) || 0.9,
      cobertura: getCoberturaFromRecord(item),
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
  const [coloresAPI, printCardPB] = await Promise.all([
    getColoresDesdeAPI(printCard),
    getPrintCard(printCard),
  ])
  if (!coloresAPI.length) return []

  const resultados: KgPorColor[] = []

  for (const colorRow of coloresAPI) {
    if (!colorRow.pantone) continue
    const tinta = await getTinta(colorRow.pantone)
    const cobertura = normalizarCobertura(colorRow.cobertura) || getCoberturaPrintCardColor(printCardPB, colorRow.pantone) || tinta?.cobertura || 0
    const bcm = tinta?.bcm ?? 0
    const densidad = tinta?.densidad ?? 0.9
    const anilox = tinta?.anilox ?? 0

    const { kgConsumo, kgBase: kgBaseCalculado, kgBruto, kgTinta, kgDisolvente } = calcularKgPorColor(
      metros, anchoCm, bcm, densidad, cobertura, kgBase
    )

    resultados.push({
      color: colorRow.pantone,
      tinta: tinta?.tinta ?? limpiarNombrePantone(colorRow.pantone),
      bcm,
      densidad,
      cobertura,
      kgConsumo,
      kgBase: kgBaseCalculado,
      kgBruto,
      kgTinta,
      kgDisolvente,
      anilox,
    })
  }

  return resultados
}

export async function getPrintCardDesdePocketBase(
  pc: PrintCardData,
  metros: number,
  anchoCm: number,
  kgBase: number
): Promise<KgPorColor[]> {
  const resultados: KgPorColor[] = []

  for (let i = 0; i < pc.colores.length; i += 1) {
    const colorNombre = pc.colores[i]
    if (!colorNombre) continue

    const tinta = await getTinta(colorNombre)
    const cobertura = pc.coberturas[i] || tinta?.cobertura || 0
    const bcm = tinta?.bcm ?? 0
    const densidad = tinta?.densidad ?? 0.9
    const anilox = tinta?.anilox ?? 0

    const { kgConsumo, kgBase: kgBaseCalculado, kgBruto, kgTinta, kgDisolvente } = calcularKgPorColor(
      metros, anchoCm, bcm, densidad, cobertura, kgBase
    )

    resultados.push({
      color: colorNombre,
      tinta: tinta?.tinta ?? limpiarNombrePantone(colorNombre),
      bcm,
      densidad,
      cobertura,
      kgConsumo,
      kgBase: kgBaseCalculado,
      kgBruto,
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
): { kgConsumo: number; kgBase: number; kgBruto: number; kgTinta: number; kgDisolvente: number } {
  if (!bcm || !densidad || !anchoCm) {
    return { kgConsumo: 0, kgBase: 0, kgBruto: 0, kgTinta: 0, kgDisolvente: 0 }
  }
  const m2 = metros * (anchoCm / 100)
  const factorCobertura = cobertura > 1 ? cobertura / 100 : cobertura
  const volumenMetricoAnilox = bcm * BCM_A_CM3_M2
  const pctDisolvente = DILUCION / (1 + DILUCION)
  const kgMezclaConsumida = (m2 * volumenMetricoAnilox * factorCobertura * TRANSFERENCIA * densidad) / 1000
  const kgMezclaNecesariaTotal = kgMezclaConsumida + kgBase
  const kgAPrepararTotal = Math.max(0, kgMezclaNecesariaTotal - kgEnMaquina)
  const kgDisolvente = kgAPrepararTotal * pctDisolvente

  return {
    kgConsumo: Math.round(kgMezclaConsumida * 100) / 100,
    kgBase: Math.round(kgBase * 100) / 100,
    kgBruto: Math.round(kgMezclaNecesariaTotal * 100) / 100,
    kgTinta: Math.round(kgAPrepararTotal * 100) / 100,
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
  kgBase: number = 0,
): number {
  if (!velocidad || !bcm || !densidad || !anchoCm) return 999
  const factorCobertura = cobertura > 1 ? cobertura / 100 : cobertura
  const volumenMetricoAnilox = bcm * BCM_A_CM3_M2
  const consumoPorMetro = ((anchoCm / 100) * volumenMetricoAnilox * factorCobertura * TRANSFERENCIA * densidad) / 1000
  if (!consumoPorMetro) return 999
  const consumoPorMinuto = consumoPorMetro * velocidad
  const kgUtiles = Math.max(0, kgEnMaquina - kgBase)
  return Math.round(kgUtiles / consumoPorMinuto)
}

export interface InkReturn {
  id: string
  machine_id: string
  pantone: string
  kg_disponibles: number
  confirmado: boolean
  created: string
  updated: string
}

export function consolidarInkReturnsPorPantone(rows: InkReturn[]): Map<string, InkReturn> {
  const mapa = new Map<string, InkReturn>()

  for (const row of rows) {
    const actual = mapa.get(row.pantone)
    if (!actual) {
      mapa.set(row.pantone, row)
      continue
    }

    const preferido = row.confirmado && !actual.confirmado ? row : actual
    mapa.set(row.pantone, {
      ...preferido,
      kg_disponibles: actual.kg_disponibles + row.kg_disponibles,
      confirmado: actual.confirmado && row.confirmado,
      updated: row.updated > actual.updated ? row.updated : actual.updated,
    })
  }

  return mapa
}

function mapInkReturn(item: Record<string, unknown>): InkReturn {
  return {
    id: String(item.id ?? ""),
    machine_id: String(item.machine_id ?? ""),
    pantone: String(item.pantone ?? ""),
    kg_disponibles: parseFloat(String(item.kg_disponibles ?? "0")) || 0,
    confirmado: Boolean(item.confirmado),
    created: String(item.created ?? ""),
    updated: String(item.updated ?? ""),
  }
}

export async function getInkReturns(machineId: string): Promise<InkReturn[]> {
  try {
    const res = await fetch(
      `${PB_URL}/api/collections/ink_returns/records?filter=(machine_id='${encodeURIComponent(machineId)}')&perPage=200`
    )
    if (!res.ok) return []
    const data = await res.json()
    return (data.items ?? []).map(mapInkReturn)
  } catch (e) {
    console.error("Error fetching ink_returns:", e)
    return []
  }
}

export async function getPendingInkReturns(): Promise<InkReturn[]> {
  try {
    const filter = encodeURIComponent("(confirmado=false)")
    const res = await fetch(
      `${PB_URL}/api/collections/ink_returns/records?filter=${filter}&sort=-created&perPage=200`
    )
    if (!res.ok) return []
    const data = await res.json()
    return (data.items ?? []).map(mapInkReturn)
  } catch (e) {
    console.error("Error fetching pending ink_returns:", e)
    return []
  }
}

export async function getConfirmedInkReturns(): Promise<InkReturn[]> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
    .toISOString()
    .replace("T", " ")
    .slice(0, 19)
  const filter = encodeURIComponent(`(confirmado=true&&updated>='${since}')`)
  try {
    const res = await fetch(
      `${PB_URL}/api/collections/ink_returns/records?filter=${filter}&sort=-updated&perPage=200`
    )
    if (!res.ok) return []
    const data = await res.json()
    return (data.items ?? []).map(mapInkReturn)
  } catch (e) {
    console.error("Error fetching confirmed ink_returns:", e)
    return []
  }
}

export async function confirmInkReturn(id: string): Promise<InkReturn | null> {
  try {
    const res = await fetch(`${PB_URL}/api/collections/ink_returns/records/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmado: true }),
    })
    if (!res.ok) return null
    return mapInkReturn(await res.json())
  } catch (e) {
    console.error("Error confirming ink_return:", e)
    return null
  }
}

export async function createInkReturn(
  machineId: string,
  pantone: string,
  kgDisponibles: number,
  confirmado: boolean = false
): Promise<InkReturn | null> {
  try {
    const res = await fetch(`${PB_URL}/api/collections/ink_returns/records`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ machine_id: machineId, pantone, kg_disponibles: kgDisponibles, confirmado }),
    })
    if (!res.ok) return null
    return mapInkReturn(await res.json())
  } catch (e) {
    console.error("Error creating ink_return:", e)
    return null
  }
}

export async function updateInkReturn(
  id: string,
  kgDisponibles: number,
  confirmado?: boolean
): Promise<InkReturn | null> {
  try {
    const payload: { kg_disponibles: number; confirmado?: boolean } = { kg_disponibles: kgDisponibles }
    if (confirmado !== undefined) payload.confirmado = confirmado

    const res = await fetch(`${PB_URL}/api/collections/ink_returns/records/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
    if (!res.ok) return null
    return mapInkReturn(await res.json())
  } catch (e) {
    console.error("Error updating ink_return:", e)
    return null
  }
}

export async function deleteInkReturn(id: string): Promise<boolean> {
  try {
    const res = await fetch(`${PB_URL}/api/collections/ink_returns/records/${id}`, {
      method: "DELETE",
    })
    return res.ok
  } catch (e) {
    console.error("Error deleting ink_return:", e)
    return false
  }
}

function getCoberturaPrintCardColor(pc: PrintCardData | null, pantone: string): number {
  if (!pc) return 0

  const target = normalizarPantoneComparable(pantone)
  const index = pc.colores.findIndex((color) => normalizarPantoneComparable(color) === target)
  return index >= 0 ? pc.coberturas[index] ?? 0 : 0
}

function parsePrintCardRecord(r: Record<string, unknown>): PrintCardData {
  const colores: string[] = []
  const coberturas: number[] = []

  for (let i = 1; i <= 10; i += 1) {
    const color = String(r[`color_${i}`] ?? "").trim()
    const cobertura = normalizarCobertura(r[`cob_${i}`])
    if (!color) continue
    colores.push(color)
    coberturas.push(cobertura)
  }

  return {
    id: String(r.id ?? "") || undefined,
    print_card: String(r.print_card ?? ""),
    producto: String(r.producto ?? ""),
    ancho: parseFloat(String(r.ancho ?? "0")) || 0,
    maquina: String(r.maquina ?? ""),
    colores,
    coberturas,
  }
}

export async function getPrintCard(printCard: string): Promise<PrintCardData | null> {
  try {
    const filter = encodeURIComponent(`(print_card='${escapePocketBaseString(printCard)}')`)
    const collections = ["print_cards", "printcard"]

    for (const collection of collections) {
      const res = await fetch(
        `${PB_URL}/api/collections/${collection}/records?filter=${filter}&perPage=1`
      )
      if (!res.ok) continue

      const data = await res.json()
      if (data.items?.length) return parsePrintCardRecord(data.items[0])
    }

    return null
  } catch (e) {
    console.error("Error fetching print card:", e)
    return null
  }
}

export async function getPrintCardsCatalogo(): Promise<PrintCardData[]> {
  try {
    const collections = ["print_cards", "printcard"]
    const printCards = new Map<string, PrintCardData>()

    for (const collection of collections) {
      let page = 1
      let totalPages = 1

      do {
        const res = await fetch(
          `${PB_URL}/api/collections/${collection}/records?sort=print_card&perPage=500&page=${page}`
        )
        if (!res.ok) break

        const data = await res.json()
        totalPages = data.totalPages ?? 1

        for (const item of data.items ?? []) {
          const pc = parsePrintCardRecord(item)
          if (!pc.print_card || printCards.has(pc.print_card)) continue
          printCards.set(pc.print_card, pc)
        }

        page += 1
      } while (page <= totalPages)
    }

    return [...printCards.values()].sort((a, b) => a.print_card.localeCompare(b.print_card))
  } catch (e) {
    console.error("Error fetching catalogo de print cards:", e)
    return []
  }
}

export async function createPrintCard(pc: PrintCardData): Promise<PrintCardData | null> {
  try {
    const payload: Record<string, unknown> = {
      print_card: pc.print_card,
      producto: pc.producto,
      ancho: pc.ancho,
      maquina: pc.maquina,
    }

    pc.colores.slice(0, 10).forEach((color, index) => {
      const n = index + 1
      payload[`color_${n}`] = color
      payload[`cob_${n}`] = pc.coberturas[index] ?? 0
    })

    const res = await fetch(`${PB_URL}/api/collections/print_cards/records${pc.id ? `/${pc.id}` : ""}`, {
      method: pc.id ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      console.error("Error creating print card:", await res.text())
      return null
    }

    return parsePrintCardRecord(await res.json())
  } catch (e) {
    console.error("Error creating print card:", e)
    return null
  }
}

function normalizarCodigoMaquina(value: string): string | null {
  const match = value.match(/(?:^|[^0-9])I?(\d{1,2})(?:$|[^0-9])/i) ?? value.match(/(\d{1,2})$/)
  if (!match?.[1]) return null
  return match[1].padStart(2, "0")
}

function parseKgBaseMaquina(item: Record<string, unknown>): number | null {
  const value = item.kg_base ?? item.kgBase ?? item.kgbase ?? item.base_kg
  const kgBase = parseFloat(String(value ?? ""))
  return Number.isFinite(kgBase) ? kgBase : null
}

export async function getKgBaseMaquina(maquinaNombre: string): Promise<number | null> {
  try {
    const nombre = maquinaNombre.trim()
    const codigo = normalizarCodigoMaquina(nombre)
    if (!nombre && !codigo) return null

    const res = await fetch(`${PB_URL}/api/collections/maquinas/records?perPage=500`)
    if (!res.ok) return null

    const data = await res.json()
    const item = (data.items ?? []).find((record: Record<string, unknown>) => {
      const recordCodigo = normalizarCodigoMaquina(String(record.codigo ?? record.nombre ?? record.maquina ?? ""))
      if (codigo && recordCodigo === codigo) return true

      const nombreRecord = String(record.nombre ?? record.maquina ?? "").trim().toLowerCase()
      return !!nombre && nombreRecord === nombre.toLowerCase()
    }) as Record<string, unknown> | undefined

    return item ? parseKgBaseMaquina(item) : null
  } catch (e) {
    console.error("Error fetching kg base de maquina:", e)
    return null
  }
}

export async function getMaquinasCatalogo(): Promise<CatalogoMaquina[]> {
  try {
    const perPage = 500
    let page = 1
    let totalPages = 1
    const maquinas = new Map<string, CatalogoMaquina>()

    while (page <= totalPages) {
      const res = await fetch(`${PB_URL}/api/collections/maquinas/records?perPage=${perPage}&page=${page}`)

      if (!res.ok) return []

      const data = await res.json()
      totalPages = Number(data.totalPages ?? 1)

      for (const item of data.items ?? []) {
        const nombre = String(item.nombre ?? item.maquina ?? "").trim()
        const codigo = normalizarCodigoMaquina(nombre)
        if (!nombre || !codigo || maquinas.has(codigo)) continue

        maquinas.set(codigo, {
          id: `bobst-${codigo}`,
          codigo,
          nombre: `Prensa ${codigo}`,
          kgBase: parseKgBaseMaquina(item) ?? undefined,
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
