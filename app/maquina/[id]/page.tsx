"use client"

import { useState, useEffect, useCallback, useMemo, useRef } from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { useInkStore } from "@/lib/store"
import { useTableroHub } from "@/lib/tablero-hub"
import { machineIdToPrensa, normalizePrensaCode } from "@/lib/tablero-mappers"
import { calcularTiempoMinutos, determinarUrgencia, type NivelUrgencia, type SolicitudTinta } from "@/lib/mock-data"
import {
  getPrintCard, getTinta, calcularKgPorColor, calcularTiempoPorTinta, type KgPorColor,
  getInkReturns, createInkReturn, updateInkReturn, deleteInkReturn, type InkReturn,
  getAniloxCatalogo, getKgBaseMaquina, normalizarCobertura, type AniloxCatalogo,
  consolidarInkReturnsPorPantone,
} from "@/lib/pocketbase"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { StatusBadge } from "@/components/status-badge"
import { FlashingAlert } from "@/components/flashing-alert"
import { UrgencyBadge } from "@/components/urgency-badge"
import { cn } from "@/lib/utils"
import { getLiveDeadline, type LiveDeadlineTone } from "@/lib/live-deadline"
import {
  ArrowLeft, Droplets, Gauge, LoaderCircle, Ruler, Printer, Send, ExternalLink, FileText,
  ZoomIn, ZoomOut, Maximize2, RotateCcw, Activity, AlertCircle, Undo2, PencilLine, FlaskConical, Timer, ChevronDown
} from "lucide-react"
import { toast } from "sonner"

const MARGEN_MINUTOS = 10
const METROS_DECISION_STORAGE_PREFIX = "ink-request:metros-decision"

function aplicarMargen(minutos: number): number {
  return minutos === 999 ? 999 : Math.max(0, minutos - MARGEN_MINUTOS)
}

function deadlineBadgeClass(tone: LiveDeadlineTone) {
  switch (tone) {
    case "expired":
      return "border-red-500 bg-red-600 text-white"
    case "red":
      return "border-red-300 bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-400"
    case "amber":
      return "border-amber-300 bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-400"
    case "green":
      return "border-emerald-300 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-400"
    default:
      return "border-border bg-muted text-muted-foreground"
  }
}

const KG_BASE_MAQUINA: Record<string, number> = {
  "I01-BOBST 1": 20,
  "I02-BOBST 2": 20,
  "I03-VISION 4": 10,
  "I04-VISION 3": 10,
  "I05-VISION 2": 10,
  "I06-BOBST 3": 20,
  "I07-VISION 1": 10,
  "I08-SCHIAVI": 20,
}

const COBERTURAS_BOBST_03_E_11182_A_R_1 = [
  { pantone: "PANTONE MAGENTA", cobertura: 30.6, alias: "Magenta" },
  { pantone: "PANTONE NEGRO", cobertura: 22.1, alias: "Negro Seleccion" },
  { pantone: "PANTONE AMARILLO", cobertura: 32.3, alias: "P. Amarillo" },
  { pantone: "PANTONE 485 C", cobertura: 0.8, alias: "P. Marron" },
  { pantone: "PANTONE 4975 C", cobertura: 4.3, alias: "P. Rosa" },
  { pantone: "PANTONE BLANCO", cobertura: 84.5, alias: "Blanco Laminacion" },
  { pantone: "PANTONE CYAN", cobertura: 3.5, alias: "Cyan" },
  { pantone: "PANTONE REFLEX BLUE C", display: "NEGRO PLASTA", displayTinta: "P. Negro Plasta", cobertura: 4, alias: "" },
]

function normalizarPantoneKey(value: string): string {
  return value.trim().replace(/\s+/g, " ").toUpperCase()
}

function aplicarCoberturasHardcodeadas(
  machineId: string,
  printCard: string,
  colores: { pantone: string, cobertura: number, orden: number, lookupPantone?: string, displayTinta?: string }[]
) {
  if (machineId !== "bobst-03" || printCard !== "E-11182-A_R-1") {
    return {
      colores,
      aliases: new Map<string, string>(),
    }
  }

  const aliases = new Map<string, string>()
  const overrides = new Map(
    COBERTURAS_BOBST_03_E_11182_A_R_1.map((item, index) => {
      if (item.alias) aliases.set(normalizarPantoneKey(item.pantone), item.alias)
      return [normalizarPantoneKey(item.pantone), { ...item, orden: index + 1 }]
    })
  )
  const usados = new Set<string>()
  const coloresConOverride = colores.map((color, index) => {
    const key = normalizarPantoneKey(color.pantone)
    const override = overrides.get(key)
    if (!override) return color
    usados.add(key)
    return {
      pantone: override.display ?? override.pantone,
      lookupPantone: override.pantone,
      displayTinta: override.displayTinta,
      cobertura: override.cobertura,
      orden: color.orden || index + 1,
    }
  })

  overrides.forEach((override, key) => {
    if (!usados.has(key)) {
      coloresConOverride.push({
        pantone: override.display ?? override.pantone,
        lookupPantone: override.pantone,
        displayTinta: override.displayTinta,
        cobertura: override.cobertura,
        orden: override.orden,
      })
    }
  })

  return {
    colores: coloresConOverride.sort((a, b) => (a.orden || 0) - (b.orden || 0)),
    aliases,
  }
}

interface FilaColor extends KgPorColor {
  kgEnMaquina: string
  viscosidad: string
  enviando: boolean
  alias?: string
}

interface ValidationWarning {
  color: string
  campos: string[]
}

interface SolicitudConfirmacion {
  rowIndex: number
  kgInput: string
  kgSugeridos: number
  tiempoMin: number
  urgencia: NivelUrgencia
  autorizacionExtra: boolean
}

interface RecepcionDeposito {
  solicitud: SolicitudTinta
  kgDepositarInput: string
  destinoSobrante: "maquina" | "cocina"
  guardando: boolean
}

interface ResumenTintaOrden {
  color: string
  calculado: number
  enMaquina: number
  solicitado: number
  pendiente: number
  fabricando: number
  fabricado: number
  entregado: number
  sugerido: number
}

function roundKg(value: number): number {
  return Math.round(value * 10) / 10
}

function formatKg(value: number): string {
  return `${roundKg(value)} kg`
}

function getControlTintaEstado(kgCalculado: number, kgSolicitado: number) {
  const diferencia = roundKg(kgSolicitado - kgCalculado)
  if (!(kgCalculado > 0)) return { label: "Sin calculo", className: "border-border bg-muted text-muted-foreground", diferencia }
  if (!(kgSolicitado > 0)) return { label: "Faltante", className: "border-red-300 bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-400", diferencia }
  if (Math.abs(diferencia) <= 0.05) return { label: "Correcto", className: "border-emerald-300 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400", diferencia: 0 }
  if (diferencia > 0) return { label: "Exceso", className: "border-amber-300 bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-400", diferencia }
  return { label: "Faltante", className: "border-red-300 bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-400", diferencia }
}

// ── Stat card ─────────────────────────────────────────────────────────────────
function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  children,
}: {
  icon: React.ElementType
  label: string
  value?: string
  sub?: string
  children?: React.ReactNode
}) {
  return (
    <div className="rounded-xl border bg-card p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</span>
        <Icon className="h-4 w-4 text-muted-foreground/50" />
      </div>
      {children ?? (
        <>
          <p className="text-2xl font-bold font-mono text-foreground leading-none">{value}</p>
          {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
        </>
      )}
    </div>
  )
}

// ── Document preview card ──────────────────────────────────────────────────────
function DocCard({
  label,
  printCard,
  src,
  fullSrc,
  onExpand,
}: {
  label: string
  printCard: string
  src: string
  fullSrc: string
  onExpand: () => void
}) {
  return (
    <div className="rounded-xl border bg-card overflow-hidden flex flex-col">
      <div className="flex items-center justify-between px-4 py-2.5 border-b">
        <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <FileText className="h-3.5 w-3.5" />
          {label}
        </span>
        {printCard && (
          <div className="flex items-center gap-0.5">
            <Button variant="ghost" size="icon" className="h-6 w-6" title="Pantalla completa" onClick={onExpand}>
              <Maximize2 className="h-3 w-3" />
            </Button>
            <a href={fullSrc} target="_blank" rel="noopener noreferrer">
              <Button variant="ghost" size="icon" className="h-6 w-6" title="Nueva pestaña">
                <ExternalLink className="h-3 w-3" />
              </Button>
            </a>
          </div>
        )}
      </div>
      {printCard ? (
        <button className="flex-1 cursor-zoom-in focus:outline-none" onClick={onExpand} title="Click para ampliar">
          <iframe src={src} className="w-full h-32 border-0 pointer-events-none" title={label} />
        </button>
      ) : (
        <div className="flex-1 flex items-center justify-center h-32 text-xs text-muted-foreground">
          Sin documento asignado
        </div>
      )}
    </div>
  )
}

// ── Zoom modal ─────────────────────────────────────────────────────────────────
function ZoomModal({
  open,
  onClose,
  title,
  src,
  fullSrc,
  zoom,
  onZoom,
}: {
  open: boolean
  onClose: () => void
  title: string
  src: string
  fullSrc: string
  zoom: number
  onZoom: (z: number) => void
}) {
  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="max-w-5xl w-[95vw] h-[90vh] flex flex-col p-0 gap-0">
        <DialogHeader className="flex flex-row items-center justify-between px-4 py-2.5 border-b shrink-0">
          <DialogTitle className="text-xs font-mono text-muted-foreground">{title}</DialogTitle>
          <div className="flex items-center gap-1 mr-8">
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onZoom(Math.max(0.5, +(zoom - 0.25).toFixed(2)))}>
              <ZoomOut className="h-3.5 w-3.5" />
            </Button>
            <span className="text-xs font-mono w-10 text-center tabular-nums">{Math.round(zoom * 100)}%</span>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onZoom(Math.min(4, +(zoom + 0.25).toFixed(2)))}>
              <ZoomIn className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onZoom(1)}>
              <RotateCcw className="h-3.5 w-3.5" />
            </Button>
            <a href={fullSrc} target="_blank" rel="noopener noreferrer">
              <Button variant="ghost" size="icon" className="h-7 w-7">
                <ExternalLink className="h-3.5 w-3.5" />
              </Button>
            </a>
          </div>
        </DialogHeader>
        <div
          className="flex-1 overflow-auto"
          onWheel={e => {
            e.preventDefault()
            onZoom(Math.min(4, Math.max(0.5, +(zoom + (e.deltaY < 0 ? 0.1 : -0.1)).toFixed(2))))
          }}
        >
          <iframe
            src={src}
            title={title}
            style={{
              width: `${100 / zoom}%`,
              height: `${100 / zoom}%`,
              minHeight: "100%",
              border: "none",
              transform: `scale(${zoom})`,
              transformOrigin: "top left",
              display: "block",
            }}
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
export default function MaquinaPage() {
  const params = useParams()
  const id = params.id as string
  const normalizedId = /^\d{1,2}$/.test(id) ? `bobst-${id.padStart(2, "0")}` : id
  const prensa = machineIdToPrensa(normalizedId) ?? machineIdToPrensa(id)

  const { getSolicitudesPorMaquina, getNotificacionesPorMaquina, confirmarRecepcion, confirmarDeposito, crearSolicitud } = useInkStore()
  const { datos: datosTablero, connectionState, hasSynced, error } = useTableroHub(prensa ?? undefined)

  const tableroActual = datosTablero.find((row) => normalizePrensaCode(row.prensa) === prensa) ?? null
  const cargando = !hasSynced && connectionState !== "Disconnected"

  const metrosRestantes = tableroActual?.metrosFaltantes ?? 0
  const metrosTotales = tableroActual?.metrosSolicitados ?? 0
  const requiereIngresoManual = tableroActual?.requiereIngresoManual ?? false
  const progreso = tableroActual?.porcentaje ?? 0
  const printCard = tableroActual?.printCard ?? ""
  const ordenProduccion = tableroActual?.orden ?? ""
  const nombreMaquina = tableroActual ? `Prensa ${tableroActual.prensa}` : `Prensa ${prensa ?? id}`
  const estado = progreso >= 100 ? "cambio" : "activa"

  const [velocidad, setVelocidad] = useState("")
  const [filas, setFilas] = useState<FilaColor[]>([])
  const [aniloxCatalogo, setAniloxCatalogo] = useState<AniloxCatalogo[]>([])
  const [loadingPC, setLoadingPC] = useState(false)
  const [anchoCm, setAnchoCm] = useState(0)
  const [anchoInput, setAnchoInput] = useState("")
  const [maquinaNombre, setMaquinaNombre] = useState("")
  const loadRequestRef = useRef(0)
  const [pcModalOpen, setPcModalOpen] = useState(false)
  const [pcZoom, setPcZoom] = useState(1)
  const [fichaModalOpen, setFichaModalOpen] = useState(false)
  const [fichaZoom, setFichaZoom] = useState(1)
  const [validationWarning, setValidationWarning] = useState<ValidationWarning | null>(null)
  const [inkReturns, setInkReturns] = useState<Map<string, InkReturn>>(new Map())
  const [returnModal, setReturnModal] = useState<{
    rowIndex: number; pantone: string; existingId: string | null; existingKg: number
  } | null>(null)
  const [returnKgInput, setReturnKgInput] = useState("")
  const [returningInk, setReturningInk] = useState(false)
  const [metrosManual, setMetrosManual] = useState<number | null>(null)
  const [metrosManualInput, setMetrosManualInput] = useState("")
  const [metrosDialogOpen, setMetrosDialogOpen] = useState(false)
  const [metrosDecisionOpen, setMetrosDecisionOpen] = useState(false)
  const [solicitudConfirmacion, setSolicitudConfirmacion] = useState<SolicitudConfirmacion | null>(null)
  const [recepcionDeposito, setRecepcionDeposito] = useState<RecepcionDeposito | null>(null)
  const [controlTintasOpen, setControlTintasOpen] = useState(false)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [kgBaseMaquina, setKgBaseMaquina] = useState(0)

  const usandoMetrosManuales = metrosManual !== null && metrosManual > 0
  const metrosRestantesEfectivos = metrosManual !== null && metrosManual > 0 ? metrosManual : metrosRestantes
  const kgBaseActual = kgBaseMaquina || (normalizedId === "bobst-03" ? 10 : KG_BASE_MAQUINA[maquinaNombre] || 0)

  const solicitudesMaquina = getSolicitudesPorMaquina(normalizedId).filter(s => s.estado !== "depositado")
  const runKeyActual = ordenProduccion && printCard ? `${normalizedId}:${ordenProduccion}:${printCard}` : ""
  const solicitudesOrdenActual = useMemo(() => {
    if (!runKeyActual) return []
    return solicitudesMaquina.filter(s =>
      s.runKey === runKeyActual ||
      (s.ordenProduccion === ordenProduccion && s.printCard === printCard)
    )
  }, [solicitudesMaquina, runKeyActual, ordenProduccion, printCard])
  const metrosDecisionStorageKey = runKeyActual ? `${METROS_DECISION_STORAGE_PREFIX}:${runKeyActual}` : ""
  const notificacionesMaquina = getNotificacionesPorMaquina(normalizedId).filter(n => !n.leida)

  const resumenPorColor = useMemo(() => {
    const mapa = new Map<string, ResumenTintaOrden>()

    solicitudesOrdenActual.forEach(s => {
      const actual = mapa.get(s.color) ?? {
        color: s.color,
        calculado: 0,
        enMaquina: 0,
        solicitado: 0,
        pendiente: 0,
        fabricando: 0,
        fabricado: 0,
        entregado: 0,
        sugerido: 0,
      }
      const kg = s.kgAFabricar || 0
      actual.solicitado += kg
      if (s.estado === "pendiente") actual.pendiente += kg
      if (s.estado === "fabricando") actual.fabricando += kg
      if (s.estado === "fabricado") actual.fabricado += s.kgFabricados || kg
      if (s.estado === "entregado") actual.entregado += s.kgFabricados || kg
      mapa.set(s.color, actual)
    })

    filas.forEach(fila => {
      const enMaquina = parseFloat(fila.kgEnMaquina) || 0
      const actual = mapa.get(fila.color) ?? {
        color: fila.color,
        calculado: 0,
        enMaquina: 0,
        solicitado: 0,
        pendiente: 0,
        fabricando: 0,
        fabricado: 0,
        entregado: 0,
        sugerido: 0,
      }
      mapa.set(fila.color, {
        ...actual,
        calculado: fila.kgTinta || 0,
        enMaquina,
        sugerido: roundKg(Math.max(0, (fila.kgTinta || 0) - actual.solicitado)),
      })
    })

    return mapa
  }, [filas, solicitudesOrdenActual])

  const resumenOrden = useMemo(() => {
    return filas.map(fila => {
      const resumen = resumenPorColor.get(fila.color)
      return resumen ?? {
        color: fila.color,
        calculado: fila.kgTinta || 0,
        enMaquina: parseFloat(fila.kgEnMaquina) || 0,
        solicitado: 0,
        pendiente: 0,
        fabricando: 0,
        fabricado: 0,
        entregado: 0,
        sugerido: fila.kgTinta || 0,
      }
    })
  }, [filas, resumenPorColor])

  useEffect(() => {
    const interval = window.setInterval(() => setNowMs(Date.now()), 1000)
    return () => window.clearInterval(interval)
  }, [])

  const cargarColores = useCallback(async (pc: string, metros: number, machineId: string) => {
    if (!pc) return
    const requestId = ++loadRequestRef.current
    setLoadingPC(true)

    let coloresAPI: { pantone: string, cobertura: number, orden: number, lookupPantone?: string, displayTinta?: string }[] = []
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/PrintCardTintas/${encodeURIComponent(pc)}`)
      if (res.ok) coloresAPI = await res.json()
    } catch (e) {
      console.error("Error fetching colores API:", e)
    }

    const hardcoded = aplicarCoberturasHardcodeadas(machineId, pc, coloresAPI)
    coloresAPI = hardcoded.colores

    if (!coloresAPI.length) {
      setFilas([])
      setLoadingPC(false)
      return
    }

    const [pcData, inkReturnsList, catalogoAnilox] = await Promise.all([
      getPrintCard(pc),
      getInkReturns(machineId),
      getAniloxCatalogo(),
    ])
    if (requestId !== loadRequestRef.current) return

    setAniloxCatalogo(catalogoAnilox)
    const inkReturnsMap = consolidarInkReturnsPorPantone(inkReturnsList)
    setInkReturns(inkReturnsMap)

    const anchoVal = pcData?.ancho ?? 0
    const maquinaVal = pcData?.maquina ?? ""
    setAnchoCm(anchoVal)
    setAnchoInput(String(Math.round(anchoVal * 10)))
    setMaquinaNombre(maquinaVal)
    const kgBaseFallback = normalizedId === "bobst-03" ? 10 : KG_BASE_MAQUINA[maquinaVal] ?? 0
    const kgBase = await getKgBaseMaquina(maquinaVal) ?? kgBaseFallback
    if (requestId !== loadRequestRef.current) return
    setKgBaseMaquina(kgBase)

    const nuevasFilas: FilaColor[] = []
    for (const colorRow of coloresAPI) {
      if (!colorRow.pantone) continue

      const pantoneBusqueda = colorRow.lookupPantone ?? colorRow.pantone
      const nombreLimpio = pantoneBusqueda.replace(/^PANTONE\s+/i, "").trim()
      const tinta = await getTinta(nombreLimpio)
      if (requestId !== loadRequestRef.current) return

      const cobertura = normalizarCobertura(colorRow.cobertura) || tinta?.cobertura || 0
      const bcmRaw = tinta?.bcm ?? 0
      const densidad = tinta?.densidad ?? 0.9

      let bcm = bcmRaw
      let anilox = tinta?.anilox ?? 0
      if (catalogoAnilox.length > 0 && bcmRaw > 0) {
        const closest = catalogoAnilox.reduce((prev, curr) =>
          Math.abs(curr.bcm - bcmRaw) < Math.abs(prev.bcm - bcmRaw) ? curr : prev
        )
        bcm = closest.bcm
        anilox = closest.lpi
      }

      const ret = inkReturnsMap.get(colorRow.pantone)
      const kgDisponibles = ret?.confirmado === true ? ret.kg_disponibles : 0

      const { kgConsumo, kgBase: kgBaseCalculado, kgBruto, kgTinta, kgDisolvente } = calcularKgPorColor(
        metros, anchoVal, bcm, densidad, cobertura, kgBase, kgDisponibles
      )

      nuevasFilas.push({
        color: colorRow.pantone,
        tinta: colorRow.displayTinta ?? tinta?.tinta ?? nombreLimpio,
        alias: hardcoded.aliases.get(normalizarPantoneKey(colorRow.pantone)),
        bcm,
        densidad,
        cobertura,
        kgConsumo,
        kgBase: kgBaseCalculado,
        kgBruto,
        kgTinta,
        kgDisolvente,
        anilox,
        kgEnMaquina: kgDisponibles > 0 ? String(kgDisponibles) : "",
        viscosidad: "",
        enviando: false,
      })
    }

    if (requestId !== loadRequestRef.current) return
    setFilas(nuevasFilas)
    setLoadingPC(false)
  }, [])

  useEffect(() => {
    loadRequestRef.current += 1
    setVelocidad("")
    setFilas([])
    setLoadingPC(false)
    setAnchoCm(0)
    setMaquinaNombre("")
    setInkReturns(new Map())
    setMetrosManual(null)
    setMetrosManualInput("")
  }, [normalizedId])

  useEffect(() => {
    setMetrosManual(null)
    setMetrosManualInput("")
    setMetrosDecisionOpen(false)
  }, [runKeyActual])

  useEffect(() => {
    if (!runKeyActual || !metrosDecisionStorageKey || solicitudesOrdenActual.length > 0) {
      setMetrosDecisionOpen(false)
      return
    }

    try {
      const stored = window.localStorage.getItem(metrosDecisionStorageKey)
      if (!stored) {
        setMetrosDecisionOpen(true)
        return
      }

      const decision = JSON.parse(stored) as { modo?: string; metros?: number }
      if (decision.modo === "manual" && decision.metros && decision.metros > 0) {
        setMetrosManual(decision.metros)
        setMetrosManualInput(String(Math.round(decision.metros)))
      } else {
        setMetrosManual(null)
        setMetrosManualInput("")
      }
      setMetrosDecisionOpen(false)
    } catch {
      window.localStorage.removeItem(metrosDecisionStorageKey)
      setMetrosDecisionOpen(true)
    }
  }, [runKeyActual, metrosDecisionStorageKey, solicitudesOrdenActual.length])

  useEffect(() => {
    if (printCard) {
      void cargarColores(printCard, metrosRestantesEfectivos, normalizedId)
      return
    }
    loadRequestRef.current += 1
    setFilas([])
    setLoadingPC(false)
    setAnchoCm(0)
    setMaquinaNombre("")
    setKgBaseMaquina(0)
  }, [printCard, metrosRestantesEfectivos, normalizedId, cargarColores])

  useEffect(() => {
    if (!printCard) return
    let disposed = false

    const refreshInkReturns = async () => {
      const rows = await getInkReturns(normalizedId)
      if (!disposed) setInkReturns(consolidarInkReturnsPorPantone(rows))
    }

    const interval = window.setInterval(() => void refreshInkReturns(), 5000)
    return () => {
      disposed = true
      window.clearInterval(interval)
    }
  }, [printCard, normalizedId])

  function actualizarFila(index: number, campo: keyof FilaColor, valor: string) {
    setFilas(prev => {
      const nuevas = [...prev]
      const fila = { ...nuevas[index], [campo]: valor }

      if (["bcm", "densidad", "cobertura", "kgEnMaquina"].includes(campo)) {
        const bcm = campo === "bcm" ? parseFloat(valor) || 0 : parseFloat(String(fila.bcm)) || 0
        const densidad = campo === "densidad" ? parseFloat(valor) || 0 : fila.densidad
        const cobertura = campo === "cobertura" ? parseFloat(valor) || 0 : fila.cobertura
        const kgEnMaq = campo === "kgEnMaquina" ? parseFloat(valor) || 0 : parseFloat(fila.kgEnMaquina) || 0
        const kgBase = kgBaseActual

        const { kgConsumo, kgBase: kgBaseCalculado, kgBruto, kgTinta, kgDisolvente } = calcularKgPorColor(
          metrosRestantesEfectivos, anchoCm, bcm, densidad, cobertura, kgBase, kgEnMaq
        )
        fila.kgConsumo = kgConsumo
        fila.kgBase = kgBaseCalculado
        fila.kgBruto = kgBruto
        fila.kgTinta = kgTinta
        fila.kgDisolvente = kgDisolvente
      }

      nuevas[index] = fila
      return nuevas
    })
  }

  function aplicarDepositoEnFila(pantone: string, kgDepositados: number) {
    if (!(kgDepositados > 0)) return

    setFilas(prev => prev.map(fila => {
      if (fila.color !== pantone) return fila

      const kgEnMaq = roundKg((parseFloat(fila.kgEnMaquina) || 0) + kgDepositados)
      const { kgConsumo, kgBase: kgBaseCalculado, kgBruto, kgTinta, kgDisolvente } = calcularKgPorColor(
        metrosRestantesEfectivos,
        anchoCm,
        fila.bcm,
        fila.densidad,
        fila.cobertura,
        kgBaseActual,
        kgEnMaq
      )

      return {
        ...fila,
        kgEnMaquina: String(kgEnMaq),
        kgConsumo,
        kgBase: kgBaseCalculado,
        kgBruto,
        kgTinta,
        kgDisolvente,
      }
    }))
  }

  function seleccionarAnilox(index: number, lpi: number, bcm: number) {
    setFilas(prev => {
      const nuevas = [...prev]
      const fila = { ...nuevas[index], anilox: lpi, bcm }
      const kgEnMaq = parseFloat(fila.kgEnMaquina) || 0
      const kgBase = kgBaseActual
      const { kgConsumo, kgBase: kgBaseCalculado, kgBruto, kgTinta, kgDisolvente } = calcularKgPorColor(
        metrosRestantesEfectivos, anchoCm, bcm, fila.densidad, fila.cobertura, kgBase, kgEnMaq
      )
      nuevas[index] = { ...fila, kgConsumo, kgBase: kgBaseCalculado, kgBruto, kgTinta, kgDisolvente }
      return nuevas
    })
  }

  function getMissingFields(fila: FilaColor) {
    const faltantes: string[] = []
    const kgEnMaquinaCapturado = fila.kgEnMaquina.trim() !== ""
    const kgEnMaquina = parseFloat(fila.kgEnMaquina)
    if (!(parseFloat(velocidad) > 0)) faltantes.push("Velocidad de la máquina")
    if (!(anchoCm > 0)) faltantes.push("Ancho")
    if (!kgEnMaquinaCapturado || Number.isNaN(kgEnMaquina) || kgEnMaquina < 0) faltantes.push("Kg en máquina")
    if (!(parseFloat(fila.viscosidad) > 0)) faltantes.push("Viscosidad")
    return faltantes
  }

  function calcularAutonomiaFila(fila: FilaColor): number {
    return aplicarMargen(calcularTiempoPorTinta(
      parseFloat(fila.kgEnMaquina) || 0,
      parseFloat(velocidad) || 0,
      anchoCm,
      fila.bcm,
      fila.densidad,
      fila.cobertura,
      kgBaseActual
    ))
  }

  function abrirRecepcionDeposito(sol: SolicitudTinta) {
    const kgFabricados = sol.kgFabricados ?? sol.kgAFabricar
    const kgDepositar = Math.min(kgFabricados, sol.kgAFabricar)
    setRecepcionDeposito({
      solicitud: sol,
      kgDepositarInput: String(roundKg(kgDepositar)),
      destinoSobrante: "maquina",
      guardando: false,
    })
  }

  async function confirmarRecepcionDeposito() {
    if (!recepcionDeposito) return

    const { solicitud, destinoSobrante } = recepcionDeposito
    const kgFabricados = solicitud.kgFabricados ?? solicitud.kgAFabricar
    const kgDepositar = roundKg(parseFloat(recepcionDeposito.kgDepositarInput) || 0)

    if (kgDepositar < 0 || kgDepositar > kgFabricados) {
      toast.error("Los kg a depositar no pueden exceder lo fabricado")
      return
    }

    const kgSobrante = roundKg(Math.max(0, kgFabricados - kgDepositar))
    setRecepcionDeposito(prev => prev ? { ...prev, guardando: true } : prev)

    try {
      await confirmarRecepcion(solicitud.id)

      if (kgSobrante > 0) {
        const existente = inkReturns.get(solicitud.color)
        const puedeSumarExistente = !!existente && (destinoSobrante === "maquina" || !existente.confirmado)
        const registro = puedeSumarExistente
          ? await updateInkReturn(
              existente.id,
              roundKg(existente.kg_disponibles + kgSobrante),
              destinoSobrante === "maquina" ? true : existente.confirmado
            )
          : await createInkReturn(
              normalizedId,
              solicitud.color,
              kgSobrante,
              destinoSobrante === "maquina"
            )

        if (!registro) {
          toast.error("No se pudo registrar el sobrante")
          setRecepcionDeposito(prev => prev ? { ...prev, guardando: false } : prev)
          return
        }
        setInkReturns(prev => new Map(prev).set(solicitud.color, registro))
      }

      await confirmarDeposito(solicitud.id)
      aplicarDepositoEnFila(solicitud.color, kgDepositar)
      setRecepcionDeposito(null)
      toast.success("Tinta recibida y depositada", {
        description: kgSobrante > 0
          ? `${kgDepositar} kg a máquina · ${kgSobrante} kg ${destinoSobrante === "maquina" ? "quedan disponibles" : "a devolución"}`
          : `${kgDepositar} kg depositados en máquina`,
      })
    } catch {
      toast.error("Error al confirmar recepción")
      setRecepcionDeposito(prev => prev ? { ...prev, guardando: false } : prev)
    }
  }

  async function solicitarColor(index: number) {
    const fila = filas[index]
    const faltantes = getMissingFields(fila)

    if (faltantes.length > 0) {
      setValidationWarning({ color: fila.color, campos: faltantes })
      return
    }

    const tiempoMin = calcularAutonomiaFila(fila)
    const urgencia = determinarUrgencia(tiempoMin)
    const resumen = resumenPorColor.get(fila.color)
    const kgSugeridos = resumen?.sugerido ?? fila.kgTinta

    setSolicitudConfirmacion({
      rowIndex: index,
      kgInput: String(kgSugeridos),
      kgSugeridos,
      tiempoMin,
      urgencia,
      autorizacionExtra: false,
    })
  }

  async function confirmarSolicitudColor() {
    if (!solicitudConfirmacion) return

    const { rowIndex, tiempoMin, urgencia } = solicitudConfirmacion
    const fila = filas[rowIndex]
    if (!fila) {
      setSolicitudConfirmacion(null)
      return
    }

    const kgSolicitados = Math.round((parseFloat(solicitudConfirmacion.kgInput) || 0) * 10) / 10
    if (!(kgSolicitados > 0)) {
      toast.error("Ingresa los kg de tinta a solicitar")
      return
    }

    setFilas(prev => prev.map((f, i) => i === rowIndex ? { ...f, enviando: true } : f))

    const vel = parseFloat(velocidad) || 0
    await crearSolicitud({
      impresoraId: normalizedId,
      impresoraNombre: nombreMaquina,
      ordenProduccion,
      printCard,
      metrosCalculo: metrosRestantesEfectivos,
      runKey: runKeyActual,
      cuerpoNumero: rowIndex + 1,
      color: fila.color,
      serieTinta: fila.tinta,
      kgEnMaquina: parseFloat(fila.kgEnMaquina) || 0,
      metrosRestantes: metrosRestantesEfectivos,
      superficiePorcentaje: fila.cobertura * 100,
      aniloxLineatura: fila.anilox,
      aniloxVolumen: fila.bcm,
      velocidadActual: vel,
      viscosidadActual: parseFloat(fila.viscosidad) || 0,
      anchoImpresion: anchoCm / 100,
      kgAFabricar: kgSolicitados,
      tiempoEstimadoMin: tiempoMin,
      urgencia,
    })

    toast.success(`Solicitud enviada: ${fila.color}`, {
      description: `${kgSolicitados} kg · ${tiempoMin === 999 ? "--" : tiempoMin} min`,
    })

    setSolicitudConfirmacion(null)
    setFilas(prev => prev.map((f, i) => i === rowIndex ? { ...f, enviando: false } : f))
  }

  async function confirmarDevolucion() {
    if (!returnModal) return
    const nuevoKg = Math.max(0, parseFloat(returnKgInput) || 0)
    setReturningInk(true)
    try {
      if (nuevoKg === 0) {
        if (returnModal.existingId) {
          await deleteInkReturn(returnModal.existingId)
          setInkReturns(prev => { const m = new Map(prev); m.delete(returnModal.pantone); return m })
          actualizarFila(returnModal.rowIndex, "kgEnMaquina", "0")
        }
      } else if (returnModal.existingId) {
        const updated = await updateInkReturn(returnModal.existingId, nuevoKg)
        if (updated) {
          setInkReturns(prev => new Map(prev).set(returnModal.pantone, updated))
          if (updated.confirmado) {
            actualizarFila(returnModal.rowIndex, "kgEnMaquina", String(updated.kg_disponibles))
          }
        }
      } else {
        const created = await createInkReturn(normalizedId, returnModal.pantone, nuevoKg)
        if (created) {
          setInkReturns(prev => new Map(prev).set(returnModal.pantone, created))
          // kgEnMaquina no se pre-llena hasta que cocina confirme la recepción
        }
      }
      toast.success("Devolución registrada", { description: `${returnModal.pantone} · ${nuevoKg} kg` })
      setReturnModal(null)
      setReturnKgInput("")
    } catch {
      toast.error("Error al registrar la devolución")
    } finally {
      setReturningInk(false)
    }
  }

  function abrirAjusteMetros() {
    setMetrosManualInput(metrosRestantesEfectivos > 0 ? String(Math.round(metrosRestantesEfectivos)) : "")
    setMetrosDialogOpen(true)
  }

  function confirmarMetrosProgramados() {
    setMetrosManual(null)
    setMetrosManualInput("")
    setMetrosDecisionOpen(false)
    if (metrosDecisionStorageKey) {
      window.localStorage.setItem(metrosDecisionStorageKey, JSON.stringify({ modo: "sistema" }))
    }
  }

  function abrirAjusteMetrosInicial() {
    setMetrosManualInput("")
    setMetrosDecisionOpen(false)
    setMetrosDialogOpen(true)
  }

  function guardarAjusteMetros() {
    const nuevoValor = Math.round(parseFloat(metrosManualInput) || 0)
    if (!(nuevoValor > 0)) {
      toast.error("Ingresa metros restantes mayores a cero")
      return
    }
    setMetrosManual(nuevoValor)
    setMetrosDialogOpen(false)
    if (metrosDecisionStorageKey) {
      window.localStorage.setItem(metrosDecisionStorageKey, JSON.stringify({ modo: "manual", metros: nuevoValor }))
    }
    toast.success("Metros restantes ajustados", {
      description: `Se usarán ${nuevoValor.toLocaleString()} m para cálculos y solicitudes.`,
    })
  }

  function restaurarMetrosSistema() {
    setMetrosManual(null)
    setMetrosManualInput("")
    if (metrosDecisionStorageKey) {
      window.localStorage.setItem(metrosDecisionStorageKey, JSON.stringify({ modo: "sistema" }))
    }
    toast.success("Usando metros del sistema de producción")
  }

  // ── Loading / empty states ──────────────────────────────────────────────────
  if (cargando) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <LoaderCircle className="h-9 w-9 animate-spin text-primary/50" />
          <p className="text-sm">Cargando datos de la prensa…</p>
        </div>
      </div>
    )
  }

  if (!tableroActual) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="flex flex-col items-center gap-2 text-muted-foreground">
          <AlertCircle className="h-9 w-9 opacity-30" />
          <p className="text-sm">No hay datos para esta prensa en el hub</p>
        </div>
      </div>
    )
  }

  const velNum = parseFloat(velocidad) || 0
  const tiempoMin = velNum > 0 ? aplicarMargen(calcularTiempoMinutos(metrosRestantesEfectivos, velNum)) : null
  const totalSolicitadoOrden = roundKg(resumenOrden.reduce((sum, item) => sum + item.solicitado, 0))
  const totalSugeridoOrden = roundKg(resumenOrden.reduce((sum, item) => sum + item.sugerido, 0))

  // ── Page ───────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-6">

      {/* ── Header ── */}
      <div className="flex items-start gap-3">
        <Link href="/">
          <Button variant="ghost" size="icon" className="h-8 w-8 mt-0.5 shrink-0 text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-bold text-foreground">{nombreMaquina}</h2>
            <Badge
              variant="outline"
              className={cn(
                "text-[11px] font-semibold",
                estado === "activa"
                  ? "bg-emerald-500/10 text-emerald-600 border-emerald-300 dark:text-emerald-400"
                  : "bg-amber-500/10 text-amber-600 border-amber-300 dark:text-amber-400"
              )}
            >
              {estado === "activa" ? "Activa" : "Cambio"}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-0.5 truncate">
            {tableroActual.orden}
            {tableroActual.producto ? ` · ${tableroActual.producto}` : ""}
          </p>
          <div className="flex flex-wrap items-center gap-3 mt-1">
            {printCard && (
              <span className="text-[11px] font-mono text-muted-foreground">
                Print Card: <span className="text-foreground font-semibold">{printCard}</span>
              </span>
            )}
            <span className={cn(
              "text-[11px] font-medium",
              connectionState === "Connected" ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"
            )}>
              {connectionState === "Connected" ? "● En vivo" : `○ ${connectionState}`}
              {error ? ` · ${error}` : ""}
            </span>
          </div>
        </div>
      </div>

      {/* ── Metrics row ── */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {/* Progreso */}
        <StatCard icon={Printer} label="Progreso">
          <div className="space-y-2.5">
            <div className="flex items-end justify-between">
              <span className="text-2xl font-bold font-mono text-foreground leading-none">{progreso}%</span>
              <span className="text-xs text-muted-foreground pb-0.5">
                {metrosRestantesEfectivos.toLocaleString()} m restantes
              </span>
            </div>
            <Progress value={progreso} className="h-1.5 bg-muted/40" />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <Badge
                  variant="outline"
                  className={cn(
                    "h-5 px-1.5 text-[10px] font-medium",
                    usandoMetrosManuales
                      ? "border-amber-300 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                      : requiereIngresoManual
                      ? "border-red-400 bg-red-500/10 text-red-700 dark:text-red-400"
                      : "border-emerald-300 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                  )}
                >
                  {usandoMetrosManuales
                    ? "Ajuste manual"
                    : requiereIngresoManual
                      ? "Requiere ajuste"
                    : "SiSPRO"}
                </Badge>
                {usandoMetrosManuales && (
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    Sistema: {metrosRestantes.toLocaleString()} m
                  </p>
                )}
              </div>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant={requiereIngresoManual && !usandoMetrosManuales ? "default" : "ghost"}
                  size="icon"
                  className={cn(
                    "h-7 w-7",
                    requiereIngresoManual && !usandoMetrosManuales
                      && "bg-red-500 hover:bg-red-600 text-white dark:bg-red-600 dark:hover:bg-red-700"
                  )}
                  title="Ingresar metros restantes"
                  onClick={abrirAjusteMetros}
                >
                  <PencilLine className="h-3.5 w-3.5" />
                </Button>
                {usandoMetrosManuales && (
                  <Button type="button" variant="ghost" size="icon" className="h-7 w-7" title="Restaurar metros del sistema" onClick={restaurarMetrosSistema}>
                    <Undo2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            </div>
            {!usandoMetrosManuales && requiereIngresoManual && (
              <p className="text-[10px] leading-snug font-medium text-red-600 dark:text-red-400">
                {/* Datos de metraje inconsistentes en SISPRO. Ingresa los metros reales para calcular. */}
              </p>
            )}
            {!usandoMetrosManuales && !requiereIngresoManual && (
              <p className="text-[10px] leading-snug text-muted-foreground">
                Si la orden fue cortada o el avance está desactualizado, ingresa los metros reales.
              </p>
            )}
          </div>
        </StatCard>

        {/* Metros totales */}
        <StatCard
          icon={Ruler}
          label="Metros Totales"
          value={metrosTotales.toLocaleString()}
          sub="metros lineales"
        />

        {/* Velocidad — operador la ingresa */}
        <StatCard icon={Gauge} label="Velocidad de máquina">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <Input
                type="number"
                placeholder="m/min"
                value={velocidad}
                onChange={e => setVelocidad(e.target.value)}
                className="h-9 font-mono text-lg font-bold"
              />
              <span className="text-xs text-muted-foreground whitespace-nowrap">m/min</span>
            </div>
            <p className="text-xs text-muted-foreground">
              {tiempoMin !== null && tiempoMin !== 999
                ? <><span className="text-foreground font-medium">{tiempoMin} min</span> restantes</>
                : "ingresa para calcular urgencia"}
            </p>
          </div>
        </StatCard>

        {/* Droplets — ink summary */}
        <StatCard icon={Droplets} label="Colores / Solicitudes">
          <div className="flex items-end justify-between">
            <span className="text-2xl font-bold font-mono text-foreground leading-none">{filas.length}</span>
            <div className="text-right">
              {solicitudesMaquina.length > 0 && (
                <Badge className="bg-urgency-red text-white text-[10px]">
                  {solicitudesMaquina.length} activa{solicitudesMaquina.length > 1 ? "s" : ""}
                </Badge>
              )}
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            {loadingPC ? "Cargando…" : filas.length > 0 ? "cuerpos impresores" : "sin print card"}
          </p>
        </StatCard>
      </div>

      {/* ── Documents row ── */}
      <div className="grid gap-3 sm:grid-cols-2">
        <DocCard
          label="Print Card"
          printCard={printCard}
          src={printCard ? `/api/printcard/${encodeURIComponent(printCard)}` : ""}
          fullSrc={`http://172.16.10.31/api/Printcard/${printCard}`}
          onExpand={() => { setPcZoom(1); setPcModalOpen(true) }}
        />
        <DocCard
          label="Ficha Técnica"
          printCard={printCard}
          src={printCard ? `/api/printcard/ficha/${encodeURIComponent(printCard)}` : ""}
          fullSrc={`http://172.16.10.31/api/Printcard/ficha/${printCard}`}
          onExpand={() => { setFichaZoom(1); setFichaModalOpen(true) }}
        />
      </div>

      {/* ── Zoom modals ── */}
      <ZoomModal
        open={pcModalOpen}
        onClose={() => setPcModalOpen(false)}
        title={printCard}
        src={`/api/printcard/${encodeURIComponent(printCard)}`}
        fullSrc={`http://172.16.10.31/api/Printcard/${printCard}`}
        zoom={pcZoom}
        onZoom={setPcZoom}
      />
      <ZoomModal
        open={fichaModalOpen}
        onClose={() => setFichaModalOpen(false)}
        title={`Ficha Técnica · ${printCard}`}
        src={`/api/printcard/ficha/${encodeURIComponent(printCard)}`}
        fullSrc={`http://172.16.10.31/api/Printcard/ficha/${printCard}`}
        zoom={fichaZoom}
        onZoom={setFichaZoom}
      />

      {/* ── Initial meters decision dialog ── */}
      <Dialog open={metrosDecisionOpen} onOpenChange={setMetrosDecisionOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Confirmar metros de la orden</DialogTitle>
            <DialogDescription>
              Esta orden no tiene solicitudes activas. Confirma si se imprimirá el metraje programado completo o captura los metros reales para calcular tinta.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border bg-muted/20 px-3 py-2">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Metros programados</p>
              <p className="font-mono text-lg font-semibold text-foreground">{metrosTotales.toLocaleString()} m</p>
            </div>
            <div className="rounded-lg border bg-muted/20 px-3 py-2">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Metros faltantes SiSPRO</p>
              <p className="font-mono text-lg font-semibold text-foreground">{metrosRestantes.toLocaleString()} m</p>
            </div>
          </div>
          <DialogFooter className="gap-2 sm:justify-between">
            <Button type="button" variant="outline" onClick={abrirAjusteMetrosInicial}>
              No, capturar reales
            </Button>
            <Button type="button" onClick={confirmarMetrosProgramados}>
              Sí, continuar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Manual remaining meters dialog ── */}
      <Dialog open={metrosDialogOpen} onOpenChange={setMetrosDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Ajustar metros a imprimir</DialogTitle>
            <DialogDescription>
              Ingresa los metros reales que se imprimirán para calcular la tinta de esta orden.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="rounded-lg border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                Programados: <span className="font-mono font-semibold text-foreground">{metrosTotales.toLocaleString()} m</span>
              </div>
              <div className="rounded-lg border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                SiSPRO faltantes: <span className="font-mono font-semibold text-foreground">{metrosRestantes.toLocaleString()} m</span>
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Metros reales a imprimir</label>
              <Input
                type="number"
                min="1"
                step="1"
                value={metrosManualInput}
                onChange={e => setMetrosManualInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter") {
                    e.preventDefault()
                    guardarAjusteMetros()
                  }
                }}
                placeholder="Ej. 320000"
                className="font-mono"
                autoFocus
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setMetrosDialogOpen(false)}>
              Cancelar
            </Button>
            <Button type="button" onClick={guardarAjusteMetros}>
              Usar este valor
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Validation dialog ── */}
      <AlertDialog open={validationWarning !== null} onOpenChange={open => { if (!open) setValidationWarning(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Faltan datos para calcular la solicitud</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  {validationWarning && (
                    <>Completa estos datos en <strong>{validationWarning.color}</strong> antes de solicitar:</>
                  )}
                </p>
                {validationWarning && (
                  <ul className="list-disc space-y-1 pl-5 text-sm text-foreground">
                    {validationWarning.campos.map(campo => <li key={campo}>{campo}</li>)}
                  </ul>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setValidationWarning(null)}>Entendido</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Request confirmation modal ── */}
      {solicitudConfirmacion && (() => {
        const fila = filas[solicitudConfirmacion.rowIndex]
        if (!fila) return null

        const kgSolicitados = parseFloat(solicitudConfirmacion.kgInput) || 0
        const resumen = resumenPorColor.get(fila.color)
        const kgSugeridos = solicitudConfirmacion.kgSugeridos
        const diferenciaKg = Math.round((kgSolicitados - kgSugeridos) * 10) / 10
        const requiereAutorizacionExtra = kgSolicitados > kgSugeridos || kgSugeridos <= 0
        const kgEnMaquina = parseFloat(fila.kgEnMaquina) || 0
        const kgBase = kgBaseActual
        const diferenciaTexto = diferenciaKg === 0
          ? "Sin ajuste manual"
          : `${diferenciaKg > 0 ? "+" : ""}${diferenciaKg} kg contra sugerido`

        return (
          <Dialog
            open
            onOpenChange={open => {
              if (!open && !fila.enviando) setSolicitudConfirmacion(null)
            }}
          >
            <DialogContent className="sm:max-w-2xl">
              <DialogHeader>
                <DialogTitle>Confirmar solicitud de tinta</DialogTitle>
                <DialogDescription>
                  Revisa los valores calculados antes de enviar la solicitud a cocina.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                <div className="rounded-lg border bg-muted/20 px-3 py-2">
                  <p className="text-sm font-semibold text-foreground">{fila.color}</p>
                  {fila.alias && <p className="text-xs font-medium text-foreground">{fila.alias}</p>}
                  <p className="text-xs text-muted-foreground">{fila.tinta}</p>
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-lg border px-3 py-2">
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">BCM / Anilox</p>
                    <p className="font-mono text-sm font-semibold">{fila.bcm || "ND"} / {fila.anilox || "ND"}</p>
                  </div>
                  <div className="rounded-lg border px-3 py-2">
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Densidad</p>
                    <p className="font-mono text-sm font-semibold">{fila.densidad || "ND"}</p>
                  </div>
                  <div className="rounded-lg border px-3 py-2">
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Cobertura</p>
                    <p className="font-mono text-sm font-semibold">{(fila.cobertura * 100).toFixed(1)}%</p>
                  </div>
                  <div className="rounded-lg border px-3 py-2">
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Metros restantes</p>
                    <p className="font-mono text-sm font-semibold">{metrosRestantesEfectivos.toLocaleString()} m</p>
                  </div>
                  <div className="rounded-lg border px-3 py-2">
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Kg en máquina</p>
                    <p className="font-mono text-sm font-semibold">{kgEnMaquina} kg</p>
                  </div>
                  <div className="rounded-lg border px-3 py-2">
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Base máquina</p>
                    <p className="font-mono text-sm font-semibold">{kgBase} kg</p>
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-[1fr_180px] sm:items-end">
                  <div className="space-y-2">
                    <div className="rounded-lg border px-3 py-2">
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Cálculo del sistema</p>
                      <div className="mt-1 grid gap-2 text-sm sm:grid-cols-3">
                        <div>
                          <span className="text-xs text-muted-foreground">Por consumo</span>
                          <p className="font-mono font-semibold">{formatKg(fila.kgConsumo || 0)}</p>
                        </div>
                        <div>
                          <span className="text-xs text-muted-foreground">Base máquina</span>
                          <p className="font-mono font-semibold">{formatKg(fila.kgBase || 0)}</p>
                        </div>
                        <div>
                          <span className="text-xs text-muted-foreground">Total estimado</span>
                          <p className="font-mono font-semibold">{formatKg(fila.kgBruto || 0)}</p>
                        </div>
                        <div>
                          <span className="text-xs text-muted-foreground">A solicitar</span>
                          <p className="font-mono font-semibold">{formatKg(kgSugeridos)}</p>
                        </div>
                        {/* <div>
                          <span className="text-xs text-muted-foreground">Disolvente</span>
                          <p className="font-mono font-semibold">{fila.kgDisolvente} kg</p>
                        </div> */}
                      </div>
                    </div>
                    {resumen && resumen.solicitado > 0 && (
                      <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs">
                        <span className="text-muted-foreground">Ya solicitado para esta orden: </span>
                        <span className="font-mono font-semibold text-foreground">{formatKg(resumen.solicitado)}</span>
                        <span className="text-muted-foreground"> · Pendiente/fabricando: </span>
                        <span className="font-mono font-semibold text-foreground">{formatKg(resumen.pendiente + resumen.fabricando)}</span>
                        <span className="text-muted-foreground"> · Listo/entregado: </span>
                        <span className="font-mono font-semibold text-foreground">{formatKg(resumen.fabricado + resumen.entregado)}</span>
                      </div>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-medium">Kg finales a solicitar</label>
                    <Input
                      type="number"
                      min="0"
                      step="0.1"
                      value={solicitudConfirmacion.kgInput}
                      onChange={e => setSolicitudConfirmacion(prev => prev ? { ...prev, kgInput: e.target.value } : prev)}
                      onKeyDown={e => {
                        if (e.key === "Enter") {
                          e.preventDefault()
                          void confirmarSolicitudColor()
                        }
                      }}
                      className="font-mono text-right"
                      autoFocus
                    />
                    <p className={cn(
                      "text-[10px]",
                      diferenciaKg === 0 ? "text-muted-foreground" : "text-amber-600 dark:text-amber-400"
                    )}>
                      {diferenciaTexto}
                    </p>
                    {requiereAutorizacionExtra && (
                      <label className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-500/10 px-2 py-2 text-xs text-amber-800 dark:text-amber-300">
                        <Checkbox
                          checked={solicitudConfirmacion.autorizacionExtra}
                          onCheckedChange={checked => setSolicitudConfirmacion(prev => prev ? { ...prev, autorizacionExtra: checked === true } : prev)}
                          className="mt-0.5"
                        />
                        <span>Autorizado pedir tinta adicional fuera del cálculo sugerido.</span>
                      </label>
                    )}
                  </div>
                </div>
              </div>

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setSolicitudConfirmacion(null)}
                  disabled={fila.enviando}
                >
                  Modificar datos
                </Button>
                <Button
                  type="button"
                  onClick={() => void confirmarSolicitudColor()}
                  disabled={fila.enviando || !(kgSolicitados > 0) || (requiereAutorizacionExtra && !solicitudConfirmacion.autorizacionExtra)}
                >
                  {fila.enviando
                    ? <LoaderCircle className="mr-1 h-3 w-3 animate-spin" />
                    : <Send className="mr-1 h-3 w-3" />}
                  Confirmar y enviar
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )
      })()}

      {/* ── Reception and deposit modal ── */}
      {recepcionDeposito && (() => {
        const sol = recepcionDeposito.solicitud
        const kgFabricados = sol.kgFabricados ?? sol.kgAFabricar
        const kgDepositar = roundKg(parseFloat(recepcionDeposito.kgDepositarInput) || 0)
        const kgSobrante = roundKg(Math.max(0, kgFabricados - kgDepositar))
        const kgExtra = roundKg(Math.max(0, kgFabricados - sol.kgAFabricar))

        return (
          <Dialog
            open
            onOpenChange={open => {
              if (!open && !recepcionDeposito.guardando) setRecepcionDeposito(null)
            }}
          >
            <DialogContent className="sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>Recibir y depositar tinta</DialogTitle>
                <DialogDescription>
                  Confirma cuánto entra a máquina y qué pasará con el sobrante.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                <div className="rounded-lg border bg-muted/20 px-3 py-2">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-mono text-sm font-semibold text-foreground">{sol.id}</p>
                      <p className="mt-1 text-sm font-semibold text-foreground">{sol.color}</p>
                      <p className="text-xs text-muted-foreground">{sol.serieTinta}</p>
                    </div>
                    {kgExtra > 0 && (
                      <Badge className="bg-amber-600 text-white">
                        Cocina preparó {formatKg(kgExtra)} extra
                      </Badge>
                    )}
                  </div>

                  <div className="mt-3 grid gap-2 sm:grid-cols-3">
                    <div className="rounded-md border bg-background px-3 py-2">
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Solicitado</p>
                      <p className="font-mono text-sm font-semibold">{formatKg(sol.kgAFabricar)}</p>
                    </div>
                    <div className="rounded-md border bg-background px-3 py-2">
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Fabricado</p>
                      <p className="font-mono text-sm font-semibold">{formatKg(kgFabricados)}</p>
                    </div>
                    <div className="rounded-md border bg-background px-3 py-2">
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Sobrante</p>
                      <p className="font-mono text-sm font-semibold">{formatKg(kgSobrante)}</p>
                    </div>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium">Kg a depositar en máquina</label>
                  <Input
                    type="number"
                    min="0"
                    max={kgFabricados}
                    step="0.1"
                    value={recepcionDeposito.kgDepositarInput}
                    onChange={e => setRecepcionDeposito(prev => prev ? { ...prev, kgDepositarInput: e.target.value } : prev)}
                    className="font-mono text-right"
                    autoFocus
                  />
                  <p className="text-[10px] text-muted-foreground">
                    Máximo disponible: {formatKg(kgFabricados)}
                  </p>
                </div>

                {kgSobrante > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-medium">Destino del sobrante</p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <button
                        type="button"
                        className={cn(
                          "rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                          recepcionDeposito.destinoSobrante === "maquina"
                            ? "border-emerald-400 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/20 dark:text-emerald-300"
                            : "hover:bg-muted/50"
                        )}
                        onClick={() => setRecepcionDeposito(prev => prev ? { ...prev, destinoSobrante: "maquina" } : prev)}
                      >
                        <span className="font-semibold">Se queda en máquina</span>
                        <span className="mt-0.5 block text-xs opacity-80">Queda disponible para otro trabajo.</span>
                      </button>
                      <button
                        type="button"
                        className={cn(
                          "rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                          recepcionDeposito.destinoSobrante === "cocina"
                            ? "border-amber-400 bg-amber-50 text-amber-800 dark:bg-amber-950/20 dark:text-amber-300"
                            : "hover:bg-muted/50"
                        )}
                        onClick={() => setRecepcionDeposito(prev => prev ? { ...prev, destinoSobrante: "cocina" } : prev)}
                      >
                        <span className="font-semibold">Regresa a cocina</span>
                        <span className="mt-0.5 block text-xs opacity-80">Aparece en devoluciones para confirmar.</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setRecepcionDeposito(null)}
                  disabled={recepcionDeposito.guardando}
                >
                  Cancelar
                </Button>
                <Button
                  type="button"
                  onClick={() => void confirmarRecepcionDeposito()}
                  disabled={recepcionDeposito.guardando || kgDepositar < 0 || kgDepositar > kgFabricados}
                >
                  {recepcionDeposito.guardando && <LoaderCircle className="mr-1 h-3 w-3 animate-spin" />}
                  Confirmar depósito
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )
      })()}

      {/* ── Return modal ── */}
      {returnModal && (
        <Dialog open onOpenChange={open => { if (!open) { setReturnModal(null); setReturnKgInput("") } }}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>Devolver tinta sobrante</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-1">
              <div>
                <p className="text-sm font-semibold">{returnModal.pantone}</p>
                {returnModal.existingKg > 0 && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Actualmente registrado: {returnModal.existingKg} kg disponibles
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium">Kg disponibles en máquina</label>
                <Input
                  type="number"
                  step="0.1"
                  min="0"
                  value={returnKgInput}
                  onChange={e => setReturnKgInput(e.target.value)}
                  placeholder="0.0"
                  className="font-mono"
                  autoFocus
                  onKeyDown={e => { if (e.key === "Enter") void confirmarDevolucion() }}
                />
                <p className="text-[10px] text-muted-foreground">
                  {parseFloat(returnKgInput) === 0 && returnModal.existingId
                    ? "El registro se eliminará."
                    : "Quedará pendiente de confirmación por cocina antes de usarse en el cálculo."}
                </p>
              </div>
              <div className="flex gap-2 justify-end">
                <Button variant="outline" size="sm" onClick={() => { setReturnModal(null); setReturnKgInput("") }}>
                  Cancelar
                </Button>
                <Button size="sm" onClick={() => void confirmarDevolucion()} disabled={returningInk}>
                  {returningInk ? <LoaderCircle className="h-3 w-3 animate-spin" /> : "Confirmar"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* ── Active notifications ── */}
      {notificacionesMaquina.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
            <Activity className="h-4 w-4 text-urgency-red" />
            Notificaciones activas
          </h3>
          {notificacionesMaquina.map(n => (
            <div key={n.id} className="flex items-center gap-2">
              <div className="flex-1">
                <FlashingAlert tipo={n.tipo} mensaje={n.mensaje} timestamp={n.timestamp} leida={n.leida} />
              </div>
              {n.tipo === "fabricado" && (
                <Button
                  size="sm"
                  onClick={() => {
                    const sol = solicitudesMaquina.find(s => s.id === n.solicitudId)
                    if (sol) abrirRecepcionDeposito(sol)
                  }}
                >
                  Confirmar Recepción
                </Button>
              )}
            </div>
          ))}
        </section>
      )}

      {/* ── Active requests ── */}
      {solicitudesMaquina.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-foreground">Solicitudes activas</h3>
          {solicitudesMaquina.map(s => {
            const deadline = getLiveDeadline(s.timestamp, s.tiempoEstimadoMin, nowMs)

            return (
            <div
              key={s.id}
              className={cn(
                "rounded-xl border bg-card px-4 py-3",
                deadline.isExpired && s.estado === "pendiente" && "border-red-500 bg-red-50/70 dark:bg-red-950/20"
              )}
            >
              <div className="flex flex-wrap items-center gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground">{s.id} · Cuerpo {s.cuerpoNumero}</p>
                  <p className="text-xs text-muted-foreground">{s.color}</p>
                </div>
                <div className="text-sm">
                  <span className="text-muted-foreground">Kg: </span>
                  <span className="font-mono font-bold">{s.kgAFabricar}</span>
                </div>
                {s.estado === "fabricado" && (s.kgFabricados ?? 0) > s.kgAFabricar && (
                  <Badge className="bg-amber-600 text-white">
                    +{formatKg((s.kgFabricados ?? 0) - s.kgAFabricar)} extra
                  </Badge>
                )}
                <div className={cn(
                  "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-semibold",
                  deadlineBadgeClass(deadline.tone)
                )}>
                  <Timer className="h-3.5 w-3.5" />
                  <span>{deadline.label}</span>
                  <span className="font-mono">{deadline.value}</span>
                </div>
                <UrgencyBadge urgencia={s.urgencia} />
                <StatusBadge estado={s.estado} />
                {s.estado === "fabricado" && (
                  <Button size="sm" onClick={() => abrirRecepcionDeposito(s)}>Confirmar Recepción</Button>
                )}
                {s.estado === "entregado" && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-violet-400 text-violet-700 hover:bg-violet-50 dark:text-violet-400 dark:hover:bg-violet-900/20"
                    onClick={() => void confirmarDeposito(s.id)}
                  >
                    Depositar en Máquina
                  </Button>
                )}
              </div>
            </div>
            )
          })}
        </section>
      )}

      {/* ── Current order ink control ── */}
      {resumenOrden.length > 0 && (
        <Collapsible open={controlTintasOpen} onOpenChange={setControlTintasOpen}>
          <section className="rounded-xl border bg-card">
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-muted/30"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-semibold text-foreground">Control de tintas</h3>
                    <Badge variant="outline" className="text-[10px]">
                      {resumenOrden.length} color{resumenOrden.length === 1 ? "" : "es"}
                    </Badge>
                    {totalSugeridoOrden > 0 ? (
                      <Badge className="bg-amber-600 text-white text-[10px]">
                        Pedir {formatKg(totalSugeridoOrden)}
                      </Badge>
                    ) : (
                      <Badge className="bg-emerald-600 text-white text-[10px]">
                        Cubierto
                      </Badge>
                    )}
                  </div>
                  <p className="mt-1 truncate text-[11px] text-muted-foreground">
                    {ordenProduccion && <>Orden <span className="font-mono text-foreground">{ordenProduccion}</span></>}
                    {ordenProduccion && printCard ? " · " : ""}
                    {printCard && <>Print Card <span className="font-mono text-foreground">{printCard}</span></>}
                    {totalSolicitadoOrden > 0 && <> · solicitado <span className="font-mono text-foreground">{formatKg(totalSolicitadoOrden)}</span></>}
                  </p>
                </div>
                <ChevronDown className={cn(
                  "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                  controlTintasOpen && "rotate-180"
                )} />
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="border-t">
                <div className="grid gap-px bg-border/60 sm:grid-cols-2 xl:grid-cols-4">
                  {resumenOrden.map(item => {
                    const enProceso = item.pendiente + item.fabricando
                    const listo = item.fabricado + item.entregado
                    const cubierto = item.enMaquina + item.solicitado
                    const completo = item.sugerido <= 0 && item.calculado > 0
                    const estadoControl = getControlTintaEstado(item.calculado, item.solicitado)

                    return (
                      <div key={item.color} className="bg-card p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-xs font-semibold text-foreground">{item.color}</p>
                            <p className="mt-0.5 text-[10px] text-muted-foreground">
                              Calculado <span className="font-mono text-foreground">{formatKg(item.calculado)}</span>
                            </p>
                          </div>
                          <Badge
                            variant="outline"
                            className={cn("shrink-0 text-[10px]", estadoControl.className)}
                          >
                            {estadoControl.label}
                          </Badge>
                        </div>
                        <div className="mt-3 grid grid-cols-2 gap-2 text-[10px]">
                          <div className="rounded-md border bg-background px-2 py-1.5">
                            <p className="text-muted-foreground">En máquina</p>
                            <p className="font-mono font-semibold text-foreground">{formatKg(item.enMaquina)}</p>
                          </div>
                          <div className="rounded-md border bg-background px-2 py-1.5">
                            <p className="text-muted-foreground">Solicitado</p>
                            <p className="font-mono font-semibold text-foreground">{formatKg(item.solicitado)}</p>
                          </div>
                          <div className="rounded-md border bg-background px-2 py-1.5">
                            <p className="text-muted-foreground">Diferencia</p>
                            <p className={cn(
                              "font-mono font-semibold",
                              estadoControl.diferencia > 0 ? "text-amber-700 dark:text-amber-400" : estadoControl.diferencia < 0 ? "text-red-700 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400"
                            )}>
                              {estadoControl.diferencia > 0 ? "+" : ""}{formatKg(estadoControl.diferencia)}
                            </p>
                          </div>
                          <div className="rounded-md border bg-background px-2 py-1.5">
                            <p className="text-muted-foreground">Pend./fab.</p>
                            <p className="font-mono font-semibold text-foreground">{formatKg(enProceso)}</p>
                          </div>
                          <div className="rounded-md border bg-background px-2 py-1.5">
                            <p className="text-muted-foreground">Listo/entr.</p>
                            <p className="font-mono font-semibold text-foreground">{formatKg(listo)}</p>
                          </div>
                        </div>
                        {cubierto > 0 && (
                          <p className="mt-2 text-[10px] text-muted-foreground">
                            Cobertura registrada: <span className="font-mono text-foreground">{formatKg(cubierto)}</span>
                            {!completo && <> · pendiente sugerido <span className="font-mono text-foreground">{formatKg(item.sugerido)}</span></>}
                          </p>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            </CollapsibleContent>
          </section>
        </Collapsible>
      )}

      {/* ── Beta warning ── */}
      <div className="rounded-lg border border-amber-300 bg-amber-500/10 px-4 py-3 flex items-start gap-3">
        <FlaskConical className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
        <div>
          <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">Sistema en fase de pruebas y calibración</p>
          <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
            Los cálculos de consumo son estimaciones basadas en parámetros de referencia. Verifica los valores de BCM, densidad y cobertura contra la Print Card antes de solicitar materiales para evitar desperdicio innecesario.
          </p>
        </div>
      </div>

      {/* ── Color table ── */}
      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-foreground">Cuerpos Impresores</h3>

        <div className="rounded-xl border bg-card overflow-hidden">
          {loadingPC ? (
            <div className="py-12 flex items-center justify-center gap-3 text-muted-foreground">
              <LoaderCircle className="h-5 w-5 animate-spin text-primary/50" />
              <span className="text-sm">Cargando colores del Print Card…</span>
            </div>
          ) : filas.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              {printCard
                ? `No se encontraron colores para ${printCard}`
                : "Sin Print Card asignado a esta orden"}
            </div>
          ) : (
            <>
              {/* Banner metros inválidos */}
              {requiereIngresoManual && !usandoMetrosManuales && (
                <div className="flex items-center gap-2 px-4 py-2.5 bg-red-500/10 border-b border-red-400/30">
                  <AlertCircle className="h-3.5 w-3.5 text-red-600 dark:text-red-400 shrink-0" />
                  <p className="text-xs text-red-700 dark:text-red-400 font-medium">
                    Datos de metraje inconsistentes en SISPRO — los cálculos están en cero hasta que ingreses los metros manualmente (botón  en la tarjeta de Progreso).
                  </p>
                </div>
              )}

              {/* Ancho banner */}
              <div className="flex flex-wrap items-center gap-3 px-4 py-2.5 bg-amber-500/5 border-b border-amber-500/20">
                <span className="text-xs text-amber-700 dark:text-amber-400">
                  {anchoCm > 0
                    ? <>Ancho cargado: <strong>{Math.round(anchoCm * 10)} mm</strong> — verifica contra Print Card:</>
                    : "Ancho de bobina no disponible — ingrésalo en mm:"}
                </span>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    placeholder="mm"
                    className="w-20 h-7 text-xs font-mono"
                    value={anchoInput}
                    onChange={e => setAnchoInput(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === "Enter") {
                        e.preventDefault()
                        const valCm = (parseFloat(anchoInput) || 0) / 10
                        if (!valCm) return
                        setAnchoCm(valCm)
                        const kgBase = kgBaseActual
                                setFilas(prev => prev.map(f => {
                                  if (!f.bcm || !f.densidad) return f
                                  const kgEnMaq = parseFloat(f.kgEnMaquina) || 0
                                  const { kgConsumo, kgBase: kgBaseCalculado, kgBruto, kgTinta, kgDisolvente } = calcularKgPorColor(
                                    metrosRestantesEfectivos, valCm, f.bcm, f.densidad, f.cobertura, kgBase, kgEnMaq
                                  )
                                  return { ...f, kgConsumo, kgBase: kgBaseCalculado, kgBruto, kgTinta, kgDisolvente }
                        }))
                      }
                    }}
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    onClick={() => {
                      const valCm = (parseFloat(anchoInput) || 0) / 10
                      if (!valCm) return
                      setAnchoCm(valCm)
                      const kgBase = kgBaseActual
                              setFilas(prev => prev.map(f => {
                                if (!f.bcm || !f.densidad) return f
                                const kgEnMaq = parseFloat(f.kgEnMaquina) || 0
                                const { kgConsumo, kgBase: kgBaseCalculado, kgBruto, kgTinta, kgDisolvente } = calcularKgPorColor(
                                  metrosRestantesEfectivos, valCm, f.bcm, f.densidad, f.cobertura, kgBase, kgEnMaq
                                )
                        return { ...f, kgConsumo, kgBase: kgBaseCalculado, kgBruto, kgTinta, kgDisolvente }
                      }))
                    }}
                  >
                    Calcular
                  </Button>
                </div>
              </div>

              {/* Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">#</th>
                      <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Color</th>
                      <th className="px-4 py-2.5 text-right text-xs font-medium text-muted-foreground">Anilox</th>
                      <th className="px-4 py-2.5 text-right text-xs font-medium text-muted-foreground">Densidad</th>
                      <th className="px-4 py-2.5 text-right text-xs font-medium text-muted-foreground">Cob. %</th>
                      <th className="px-4 py-2.5 text-right text-xs font-medium text-muted-foreground">Kg calc.</th>
                      <th className="px-4 py-2.5 text-right text-xs font-medium text-muted-foreground">Kg máq.</th>
                      <th className="px-4 py-2.5 text-right text-xs font-medium text-muted-foreground">Viscosidad</th>
                      <th className="px-4 py-2.5 text-center text-xs font-medium text-muted-foreground">Urgencia</th>
                      <th className="px-4 py-2.5 text-right text-xs font-medium text-muted-foreground">Acción</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {filas.map((fila, i) => (
                      <tr key={i} className="hover:bg-muted/20 transition-colors">
                        <td className="px-4 py-3 font-mono font-bold text-muted-foreground text-xs">{i + 1}</td>
                        <td className="px-4 py-3">
                          <p className="font-semibold text-foreground text-xs leading-tight">{fila.color}</p>
                          {fila.alias && <p className="text-[10px] font-medium text-foreground">{fila.alias}</p>}
                          <p className="text-[10px] text-muted-foreground">{fila.tinta}</p>
                          {(() => {
                            const ret = inkReturns.get(fila.color)
                            if (!ret || ret.kg_disponibles <= 0) return null
                                    return ret.confirmado ? (
                                      <p className="text-[10px] text-emerald-600 dark:text-emerald-400 mt-0.5">
                                        {ret.kg_disponibles} kg disponibles
                                      </p>
                                    ) : (
                                      <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-0.5">
                                        {ret.kg_disponibles} kg pendiente de confirmación
                                      </p>
                                    )
                          })()}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Select
                            value={fila.anilox > 0 ? String(fila.anilox) : ""}
                            onValueChange={val => {
                              const item = aniloxCatalogo.find(a => String(a.lpi) === val)
                              if (item) seleccionarAnilox(i, item.lpi, item.bcm)
                            }}
                          >
                            <SelectTrigger className={cn(
                              "h-7 text-xs font-mono w-40 ml-auto",
                              !fila.bcm && "border-amber-400 dark:border-amber-600"
                            )}>
                              <SelectValue placeholder="Seleccionar anilox…" />
                            </SelectTrigger>
                            <SelectContent>
                              {aniloxCatalogo.map(a => (
                                <SelectItem key={a.lpi} value={String(a.lpi)} className="font-mono text-xs">
                                  {a.lpi} LPI — BCM {a.bcm}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Input
                            type="number"
                            step="0.01"
                            value={fila.densidad || ""}
                            onChange={e => actualizarFila(i, "densidad", e.target.value)}
                            className={cn(
                              "w-20 text-right font-mono text-xs h-7 ml-auto",
                              !fila.densidad && "border-amber-400 dark:border-amber-600"
                            )}
                            placeholder="g/cm³"
                          />
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Input
                            type="number"
                            step="0.1"
                            value={fila.cobertura ? (fila.cobertura * 100).toFixed(1) : ""}
                            onChange={e => actualizarFila(i, "cobertura", String(parseFloat(e.target.value) / 100 || 0))}
                            className="w-20 text-right font-mono text-xs h-7 ml-auto"
                            placeholder="%"
                          />
                        </td>
                        <td className="px-4 py-3 text-right">
                          {fila.kgBruto > 0 ? (
                            <div className="flex flex-col items-end gap-0.5">
                              {(() => {
                                const resumen = resumenPorColor.get(fila.color)
                                const sugerido = resumen?.sugerido ?? fila.kgTinta
                                const solicitado = resumen?.solicitado ?? 0

                                return (
                                  <>
                                    <span className="font-mono font-bold text-foreground text-xs">{fila.kgBruto} kg</span>
                                    <span className="text-[10px] text-muted-foreground">
                                      consumo {formatKg(fila.kgConsumo || 0)} + base {formatKg(fila.kgBase || 0)}
                                    </span>
                                    <span className={cn(
                                      "text-[10px]",
                                      sugerido > 0 ? "text-muted-foreground" : "text-emerald-600 dark:text-emerald-400"
                                    )}>
                                      pedir: {formatKg(sugerido)}
                                    </span>
                                    {solicitado > 0 && (
                                      <span className="text-[10px] text-primary">ya solicitado: {formatKg(solicitado)}</span>
                                    )}
                                  </>
                                )
                              })()}
                            </div>
                          ) : (!fila.bcm || !fila.densidad) ? (
                            <span className="text-[10px] text-amber-600 dark:text-amber-400">Falta BCM/dens.</span>
                          ) : (
                            <span className="font-mono text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {(() => {
                            const val = parseFloat(fila.kgEnMaquina) || 0
                            const excede = fila.kgBruto > 0 && val > fila.kgBruto
                            return (
                              <div>
                                <Input
                                  type="number"
                                  step="0.1"
                                  value={fila.kgEnMaquina}
                                  onChange={e => actualizarFila(i, "kgEnMaquina", e.target.value)}
                                  className={cn(
                                    "w-20 text-right font-mono text-xs h-7 ml-auto",
                                    excede && "border-red-500 focus-visible:ring-red-500"
                                  )}
                                  placeholder="kg"
                                />
                                {excede && (
                                  <p className="mt-0.5 text-[10px] text-red-500 text-right">máx {fila.kgBruto}</p>
                                )}
                              </div>
                            )
                          })()}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Input
                            type="number"
                            value={fila.viscosidad}
                            onChange={e => actualizarFila(i, "viscosidad", e.target.value)}
                            className="w-20 text-right font-mono text-xs h-7 ml-auto"
                            placeholder="seg"
                          />
                        </td>
                        <td className="px-4 py-3 text-center">
                          {fila.kgEnMaquina && velocidad && fila.bcm ? (() => {
                            const t = calcularAutonomiaFila(fila)
                            const u = determinarUrgencia(t)
                            return <UrgencyBadge urgencia={u} tiempoMin={t === 999 ? undefined : t} pulsing />
                          })() : <span className="text-xs text-muted-foreground/50">—</span>}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {(() => {
                            const resumen = resumenPorColor.get(fila.color)
                            const sugerido = resumen?.sugerido ?? fila.kgTinta
                            const yaSolicitado = (resumen?.solicitado ?? 0) > 0
                            const botonTexto = sugerido > 0 ? "Solicitar" : yaSolicitado ? "Extra" : "Solicitar"

                            return (
                              <div className="flex flex-col items-end gap-1">
                                <Button
                                  size="sm"
                                  className="h-7 text-xs"
                                  onClick={() => solicitarColor(i)}
                                  disabled={fila.enviando || (requiereIngresoManual && !usandoMetrosManuales)}
                                  title={requiereIngresoManual && !usandoMetrosManuales ? "Ingresa los metros manualmente primero" : undefined}
                                >
                                  {fila.enviando
                                    ? <LoaderCircle className="h-3 w-3 animate-spin" />
                                    : <><Send className="mr-1 h-3 w-3" />{botonTexto}</>}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 text-xs"
                                  onClick={() => {
                                    const ret = inkReturns.get(fila.color)
                                    setReturnModal({
                                      rowIndex: i,
                                      pantone: fila.color,
                                      existingId: ret?.id ?? null,
                                      existingKg: ret?.kg_disponibles ?? 0,
                                    })
                                    setReturnKgInput(ret ? String(ret.kg_disponibles) : "")
                                  }}
                                >
                                  <Undo2 className="mr-1 h-3 w-3" />Devolver
                                </Button>
                              </div>
                            )
                          })()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  )
}
