"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { useInkStore } from "@/lib/store"
import { useTableroHub } from "@/lib/tablero-hub"
import { machineIdToPrensa, normalizePrensaCode, parseCantidadPorUnidad } from "@/lib/tablero-mappers"
import { calcularTiempoMinutos, determinarUrgencia } from "@/lib/mock-data"
import {
  getPrintCard, getTinta, calcularKgPorColor, calcularTiempoPorTinta, type KgPorColor,
  getInkReturns, createInkReturn, updateInkReturn, deleteInkReturn, type InkReturn,
} from "@/lib/pocketbase"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { StatusBadge } from "@/components/status-badge"
import { FlashingAlert } from "@/components/flashing-alert"
import { UrgencyBadge } from "@/components/urgency-badge"
import { cn } from "@/lib/utils"
import {
  ArrowLeft, Droplets, Gauge, LoaderCircle, Ruler, Printer, Send, ExternalLink, FileText,
  ZoomIn, ZoomOut, Maximize2, RotateCcw, Activity, AlertCircle, Undo2
} from "lucide-react"
import { toast } from "sonner"

const KG_BASE_MAQUINA: Record<string, number> = {
  "I01-BOBST 1": 20, "I02-BOBST 2": 20, "I03-VISION 4": 10,
  "I04-VISION 3": 10, "I05-VISION 2": 10, "I06-BOBST 3": 20,
  "I07-VISION 1": 10, "I08-SCHIAVI": 20,
}

interface FilaColor extends KgPorColor {
  kgEnMaquina: string
  viscosidad: string
  enviando: boolean
}

interface ValidationWarning {
  color: string
  campos: string[]
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

  const { getSolicitudesPorMaquina, getNotificacionesPorMaquina, confirmarRecepcion, crearSolicitud } = useInkStore()
  const { datos: datosTablero, connectionState, hasSynced, error } = useTableroHub(prensa ?? undefined)

  const tableroActual = datosTablero.find((row) => normalizePrensaCode(row.prensa) === prensa) ?? null
  const cargando = !hasSynced && connectionState !== "Disconnected"

  const metrosRestantes = tableroActual ? parseCantidadPorUnidad(tableroActual.cantidadFaltante, "MTR") ?? 0 : 0
  const metrosTotales = tableroActual ? parseCantidadPorUnidad(tableroActual.cantidadSolicitada, "MTR") ?? 0 : 0
  const progreso = tableroActual?.porcentaje ?? 0
  const printCard = tableroActual?.printCard ?? ""
  const nombreMaquina = tableroActual ? `Prensa ${tableroActual.prensa}` : `Prensa ${prensa ?? id}`
  const estado = progreso >= 100 ? "cambio" : "activa"

  const [velocidad, setVelocidad] = useState("")
  const [filas, setFilas] = useState<FilaColor[]>([])
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

  const solicitudesMaquina = getSolicitudesPorMaquina(normalizedId).filter(s => s.estado !== "entregado")
  const notificacionesMaquina = getNotificacionesPorMaquina(normalizedId).filter(n => !n.leida)

  const cargarColores = useCallback(async (pc: string, metros: number, machineId: string) => {
    if (!pc) return
    const requestId = ++loadRequestRef.current
    setLoadingPC(true)

    let coloresAPI: { pantone: string, cobertura: number, orden: number }[] = []
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/PrintCardTintas/${encodeURIComponent(pc)}`)
      if (res.ok) coloresAPI = await res.json()
    } catch (e) {
      console.error("Error fetching colores API:", e)
    }

    if (!coloresAPI.length) {
      setFilas([])
      setLoadingPC(false)
      return
    }

    const [pcData, inkReturnsList] = await Promise.all([
      getPrintCard(pc),
      getInkReturns(machineId),
    ])
    if (requestId !== loadRequestRef.current) return

    const inkReturnsMap = new Map(inkReturnsList.map(r => [r.pantone, r]))
    setInkReturns(inkReturnsMap)

    const anchoVal = pcData?.ancho ?? 0
    const maquinaVal = pcData?.maquina ?? ""
    setAnchoCm(anchoVal)
    setAnchoInput(String(Math.round(anchoVal * 10)))
    setMaquinaNombre(maquinaVal)
    const kgBase = KG_BASE_MAQUINA[maquinaVal] || 0

    const nuevasFilas: FilaColor[] = []
    for (const colorRow of coloresAPI) {
      if (!colorRow.pantone) continue
      const cobertura = (colorRow.cobertura || 0) / 100

      const nombreLimpio = colorRow.pantone.replace(/^PANTONE\s+/i, "").trim()
      const tinta = await getTinta(nombreLimpio)
      if (requestId !== loadRequestRef.current) return

      const bcm = tinta?.bcm ?? 0
      const densidad = tinta?.densidad ?? 0
      const anilox = tinta?.anilox ?? 0
      const ret = inkReturnsMap.get(colorRow.pantone)
      const kgDisponibles = ret?.confirmado === true ? ret.kg_disponibles : 0

      const { kgBruto, kgTinta, kgDisolvente } = calcularKgPorColor(
        metros, anchoVal, bcm, densidad, cobertura, kgBase, kgDisponibles
      )

      nuevasFilas.push({
        color: colorRow.pantone,
        tinta: tinta?.tinta ?? nombreLimpio,
        bcm,
        densidad,
        cobertura,
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
  }, [normalizedId])

  useEffect(() => {
    if (printCard) {
      void cargarColores(printCard, metrosRestantes, normalizedId)
      return
    }
    loadRequestRef.current += 1
    setFilas([])
    setLoadingPC(false)
    setAnchoCm(0)
    setMaquinaNombre("")
  }, [printCard, metrosRestantes, cargarColores])

  function actualizarFila(index: number, campo: keyof FilaColor, valor: string) {
    setFilas(prev => {
      const nuevas = [...prev]
      const fila = { ...nuevas[index], [campo]: valor }

      if (["bcm", "densidad", "cobertura", "kgEnMaquina"].includes(campo)) {
        const bcm = campo === "bcm" ? parseFloat(valor) || 0 : parseFloat(String(fila.bcm)) || 0
        const densidad = campo === "densidad" ? parseFloat(valor) || 0 : fila.densidad
        const cobertura = campo === "cobertura" ? parseFloat(valor) || 0 : fila.cobertura
        const kgEnMaq = campo === "kgEnMaquina" ? parseFloat(valor) || 0 : parseFloat(fila.kgEnMaquina) || 0
        const kgBase = KG_BASE_MAQUINA[maquinaNombre] || 0

        const { kgBruto, kgTinta, kgDisolvente } = calcularKgPorColor(
          metrosRestantes, anchoCm, bcm, densidad, cobertura, kgBase, kgEnMaq
        )
        fila.kgBruto = kgBruto
        fila.kgTinta = kgTinta
        fila.kgDisolvente = kgDisolvente
      }

      nuevas[index] = fila
      return nuevas
    })
  }

  function getMissingFields(fila: FilaColor) {
    const faltantes: string[] = []
    if (!(parseFloat(velocidad) > 0)) faltantes.push("Velocidad de la máquina")
    if (!(anchoCm > 0)) faltantes.push("Ancho")
    if (!(parseFloat(fila.kgEnMaquina) > 0)) faltantes.push("Kg en máquina")
    if (!(parseFloat(fila.viscosidad) > 0)) faltantes.push("Viscosidad")
    return faltantes
  }

  async function solicitarColor(index: number) {
    const fila = filas[index]
    const faltantes = getMissingFields(fila)

    if (faltantes.length > 0) {
      setValidationWarning({ color: fila.color, campos: faltantes })
      return
    }

    setFilas(prev => prev.map((f, i) => i === index ? { ...f, enviando: true } : f))

    const vel = parseFloat(velocidad) || 0
    const tiempoMin = calcularTiempoMinutos(metrosRestantes, vel)
    const urgencia = determinarUrgencia(tiempoMin)

    crearSolicitud({
      impresoraId: normalizedId,
      impresoraNombre: nombreMaquina,
      cuerpoNumero: index + 1,
      color: fila.color,
      serieTinta: fila.tinta,
      kgEnMaquina: parseFloat(fila.kgEnMaquina) || 0,
      metrosRestantes,
      superficiePorcentaje: fila.cobertura * 100,
      aniloxLineatura: fila.anilox,
      aniloxVolumen: fila.bcm,
      velocidadActual: vel,
      viscosidadActual: parseFloat(fila.viscosidad) || 0,
      anchoImpresion: anchoCm / 100,
      kgAFabricar: fila.kgTinta,
      tiempoEstimadoMin: tiempoMin,
      urgencia,
    })

    toast.success(`Solicitud enviada: ${fila.color}`, {
      description: `${fila.kgTinta} kg · ${tiempoMin === 999 ? "--" : tiempoMin} min`,
    })

    setFilas(prev => prev.map((f, i) => i === index ? { ...f, enviando: false } : f))
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
  const tiempoMin = velNum > 0 ? calcularTiempoMinutos(metrosRestantes, velNum) : null

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
          <div className="space-y-2">
            <div className="flex items-end justify-between">
              <span className="text-2xl font-bold font-mono text-foreground leading-none">{progreso}%</span>
              <span className="text-xs text-muted-foreground pb-0.5">
                {metrosRestantes.toLocaleString()} m restantes
              </span>
            </div>
            <Progress value={progreso} className="h-1.5 bg-muted/40" />
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
                <Button size="sm" onClick={() => confirmarRecepcion(n.solicitudId)}>Confirmar</Button>
              )}
            </div>
          ))}
        </section>
      )}

      {/* ── Active requests ── */}
      {solicitudesMaquina.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-foreground">Solicitudes activas</h3>
          {solicitudesMaquina.map(s => (
            <div key={s.id} className="rounded-xl border bg-card px-4 py-3">
              <div className="flex flex-wrap items-center gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground">{s.id} · Cuerpo {s.cuerpoNumero}</p>
                  <p className="text-xs text-muted-foreground">{s.color}</p>
                </div>
                <div className="text-sm">
                  <span className="text-muted-foreground">Kg: </span>
                  <span className="font-mono font-bold">{s.kgAFabricar}</span>
                </div>
                <UrgencyBadge urgencia={s.urgencia} tiempoMin={s.tiempoEstimadoMin} />
                <StatusBadge estado={s.estado} />
                {s.estado === "fabricado" && (
                  <Button size="sm" onClick={() => confirmarRecepcion(s.id)}>Confirmar Recepción</Button>
                )}
              </div>
            </div>
          ))}
        </section>
      )}

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
                        const kgBase = KG_BASE_MAQUINA[maquinaNombre] || 0
                        setFilas(prev => prev.map(f => {
                          if (!f.bcm || !f.densidad) return f
                          const { kgBruto, kgTinta, kgDisolvente } = calcularKgPorColor(
                            metrosRestantes, valCm, f.bcm, f.densidad, f.cobertura, kgBase
                          )
                          return { ...f, kgBruto, kgTinta, kgDisolvente }
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
                      const kgBase = KG_BASE_MAQUINA[maquinaNombre] || 0
                      setFilas(prev => prev.map(f => {
                        if (!f.bcm || !f.densidad) return f
                        const { kgBruto, kgTinta, kgDisolvente } = calcularKgPorColor(
                          metrosRestantes, valCm, f.bcm, f.densidad, f.cobertura, kgBase
                        )
                        return { ...f, kgBruto, kgTinta, kgDisolvente }
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
                      <th className="px-4 py-2.5 text-right text-xs font-medium text-muted-foreground">BCM</th>
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
                          <p className="text-[10px] text-muted-foreground">{fila.tinta}</p>
                          {(() => {
                            const ret = inkReturns.get(fila.color)
                            if (!ret || ret.kg_disponibles <= 0) return null
                            return ret.confirmado ? (
                              <p className="text-[10px] text-emerald-600 dark:text-emerald-400 mt-0.5">
                                🪣 {ret.kg_disponibles} kg disponibles
                              </p>
                            ) : (
                              <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-0.5">
                                ⏳ {ret.kg_disponibles} kg pendiente de confirmación
                              </p>
                            )
                          })()}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Input
                            type="number"
                            value={fila.anilox || ""}
                            onChange={e => actualizarFila(i, "anilox", e.target.value)}
                            className="w-20 text-right font-mono text-xs h-7 ml-auto"
                            placeholder="LPI"
                          />
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Input
                            type="number"
                            step="0.1"
                            value={fila.bcm || ""}
                            onChange={e => actualizarFila(i, "bcm", e.target.value)}
                            className={cn(
                              "w-20 text-right font-mono text-xs h-7 ml-auto",
                              !fila.bcm && "border-amber-400 dark:border-amber-600"
                            )}
                            placeholder="BCM"
                          />
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
                              <span className="font-mono font-bold text-foreground text-xs">{fila.kgBruto} kg</span>
                              {fila.kgTinta < fila.kgBruto && (
                                <span className="text-[10px] text-muted-foreground">pedir: {fila.kgTinta} kg</span>
                              )}
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
                            const t = calcularTiempoPorTinta(
                              parseFloat(fila.kgEnMaquina) || 0,
                              parseFloat(velocidad) || 0,
                              anchoCm, fila.bcm, fila.densidad, fila.cobertura
                            )
                            const u = determinarUrgencia(t)
                            return <UrgencyBadge urgencia={u} tiempoMin={t === 999 ? undefined : t} pulsing />
                          })() : <span className="text-xs text-muted-foreground/50">—</span>}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex flex-col items-end gap-1">
                            <Button
                              size="sm"
                              className="h-7 text-xs"
                              onClick={() => solicitarColor(i)}
                              disabled={fila.enviando}
                            >
                              {fila.enviando
                                ? <LoaderCircle className="h-3 w-3 animate-spin" />
                                : <><Send className="mr-1 h-3 w-3" />Solicitar</>}
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
