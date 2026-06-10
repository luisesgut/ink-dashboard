"use client"

import { useEffect, useRef, useState, type ElementType } from "react"
import { useInkStore } from "@/lib/store"
import type { SolicitudTinta } from "@/lib/mock-data"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { UrgencyBadge } from "@/components/urgency-badge"
import { StatusBadge } from "@/components/status-badge"
import { CocinaNav } from "@/components/cocina-nav"
import { cn } from "@/lib/utils"
import { getLiveDeadline, type LiveDeadlineTone } from "@/lib/live-deadline"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import {
  Activity,
  CheckCircle2,
  ChevronDown,
  Clock,
  Droplets,
  FlaskConical,
  Gauge,
  Layers,
  PlayCircle,
  Timer,
} from "lucide-react"
import { toast } from "sonner"

const urgenciaOrden = { rojo: 0, naranja: 1, verde: 2 }
const estadoOrden = { pendiente: 0, fabricando: 1, fabricado: 2, entregado: 3, depositado: 4 }

function formatNumber(value: number | undefined, decimals = 0) {
  if (typeof value !== "number" || Number.isNaN(value)) return "--"
  return value.toLocaleString("es-MX", {
    maximumFractionDigits: decimals,
    minimumFractionDigits: 0,
  })
}

function formatKg(value: number | undefined) {
  if (typeof value !== "number" || Number.isNaN(value)) return "--"
  return `${formatNumber(value, 1)} kg`
}

function TechPill({
  icon: Icon,
  label,
  value,
  tone = "default",
}: {
  icon: ElementType
  label: string
  value: string
  tone?: "default" | "amber" | "emerald"
}) {
  return (
    <div
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs",
        tone === "amber"
          ? "border-amber-300 bg-amber-50 text-amber-800"
          : tone === "emerald"
          ? "border-emerald-300 bg-emerald-50 text-emerald-800"
          : "border-border bg-background text-muted-foreground"
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      <span className="text-[10px] uppercase tracking-wide">{label}</span>
      <span className="font-mono font-semibold text-foreground">{value}</span>
    </div>
  )
}

function DetailMetric({
  label,
  value,
  hint,
}: {
  label: string
  value: string
  hint?: string
}) {
  return (
    <div className="rounded-md border bg-background px-3 py-2">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 font-mono text-sm font-semibold text-foreground">{value}</p>
      {hint && <p className="mt-0.5 text-[10px] text-muted-foreground">{hint}</p>}
    </div>
  )
}

function deadlineClass(tone: LiveDeadlineTone) {
  switch (tone) {
    case "expired":
      return "border-red-500 bg-red-600 text-white"
    case "red":
      return "border-red-300 bg-red-50 text-red-700"
    case "amber":
      return "border-amber-300 bg-amber-50 text-amber-800"
    case "green":
      return "border-emerald-300 bg-emerald-50 text-emerald-800"
    default:
      return "border-border bg-background text-muted-foreground"
  }
}

export default function CocinaPage() {
  const { solicitudes, marcarFabricando, marcarFabricado } = useInkStore()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [selectedSolicitud, setSelectedSolicitud] = useState<SolicitudTinta | null>(null)
  const [kgFabricados, setKgFabricados] = useState("")
  const [expandedSolicitudId, setExpandedSolicitudId] = useState<string | null>(null)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const pendingIdsRef = useRef<Set<string>>(new Set())
  const isPendingTrackerReadyRef = useRef(false)
  const audioContextRef = useRef<AudioContext | null>(null)

  function playNotificationSound() {
    if (typeof window === "undefined") return
    const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioContextClass) return

    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContextClass()
    }

    const ctx = audioContextRef.current
    const now = ctx.currentTime
    const oscillator = ctx.createOscillator()
    const gain = ctx.createGain()

    oscillator.type = "triangle"
    oscillator.frequency.setValueAtTime(880, now)
    oscillator.frequency.exponentialRampToValueAtTime(660, now + 0.2)

    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.exponentialRampToValueAtTime(0.2, now + 0.01)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.25)

    oscillator.connect(gain)
    gain.connect(ctx.destination)
    oscillator.start(now)
    oscillator.stop(now + 0.25)
  }

  useEffect(() => {
    const pendingIds = new Set(
      solicitudes.filter((sol) => sol.estado === "pendiente").map((sol) => sol.id)
    )

    // Primer render: solo inicializamos referencia sin sonido.
    if (!isPendingTrackerReadyRef.current) {
      pendingIdsRef.current = pendingIds
      isPendingTrackerReadyRef.current = true
      return
    }

    const hasNewPending = [...pendingIds].some((id) => !pendingIdsRef.current.has(id))
    if (hasNewPending) {
      if (audioContextRef.current?.state === "suspended") {
        audioContextRef.current.resume().then(playNotificationSound).catch(() => {})
      } else {
        playNotificationSound()
      }
    }

    pendingIdsRef.current = pendingIds
  }, [solicitudes])

  useEffect(() => {
    const interval = window.setInterval(() => setNowMs(Date.now()), 1000)
    return () => window.clearInterval(interval)
  }, [])

  useEffect(() => {
    return () => {
      audioContextRef.current?.close().catch(() => {})
      audioContextRef.current = null
    }
  }, [])

  const solicitudesActivas = [...solicitudes]
    .filter((s) => s.estado !== "entregado")
    .sort(
      (a, b) => {
        const estadoDiff = estadoOrden[a.estado] - estadoOrden[b.estado]
        if (estadoDiff !== 0) return estadoDiff

        if (a.estado === "pendiente" || a.estado === "fabricando") {
          const deadlineA = getLiveDeadline(a.timestamp, a.tiempoEstimadoMin, nowMs)
          const deadlineB = getLiveDeadline(b.timestamp, b.tiempoEstimadoMin, nowMs)
          if (deadlineA.sortValue !== deadlineB.sortValue) return deadlineA.sortValue - deadlineB.sortValue
        }

        return urgenciaOrden[a.urgencia] - urgenciaOrden[b.urgencia]
      }
    )

  const pendientes = solicitudes.filter((s) => s.estado === "pendiente").length
  const fabricando = solicitudes.filter((s) => s.estado === "fabricando").length
  const fabricados = solicitudes.filter((s) => s.estado === "fabricado").length

  function handleFabricar(solId: string) {
    marcarFabricando(solId)
    toast.info("Estado cambiado a FABRICANDO", {
      description: "Notificacion enviada al operador de maquina",
    })
  }

  function handleOpenFabricado(sol: SolicitudTinta) {
    setSelectedSolicitud(sol)
    setKgFabricados(sol.kgAFabricar.toString())
    setDialogOpen(true)
  }

  function handleConfirmFabricado() {
    if (!selectedSolicitud) return
    marcarFabricado(selectedSolicitud.id, parseFloat(kgFabricados) || 0)
    setDialogOpen(false)
    toast.success("Tinta marcada como FABRICADO", {
      description: `${kgFabricados} kg listos para entrega`,
    })
  }

  return (
    <div className="flex flex-col gap-6">
      <CocinaNav />

      <div>
        <h2 className="text-2xl font-bold text-foreground">
          Cocina de Tintas
        </h2>
        <p className="text-sm text-muted-foreground">
          Cola de solicitudes ordenadas por urgencia - Primero pendientes, luego en proceso
        </p>
      </div>

      {/* Summary stats */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="border-urgency-red/30">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Pendientes
            </CardTitle>
            <Clock className="h-4 w-4 text-urgency-red" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold font-mono text-urgency-red">{pendientes}</div>
          </CardContent>
        </Card>
        <Card className="border-amber-300/50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Fabricando
            </CardTitle>
            <FlaskConical className="h-4 w-4 text-amber-600" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold font-mono text-amber-600">{fabricando}</div>
          </CardContent>
        </Card>
        <Card className="border-emerald-300/50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Fabricados
            </CardTitle>
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold font-mono text-emerald-600">{fabricados}</div>
          </CardContent>
        </Card>
      </div>

      {/* Queue */}
      {solicitudesActivas.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <FlaskConical className="mb-3 h-12 w-12 opacity-30" />
            <p className="text-lg font-medium">Sin solicitudes activas</p>
            <p className="text-sm">Todas las solicitudes han sido entregadas</p>
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {solicitudesActivas.map((sol) => {
            const deadline = getLiveDeadline(sol.timestamp, sol.tiempoEstimadoMin, nowMs)

            return (
            <Card
              key={sol.id}
              className={cn(
                "overflow-hidden shadow-sm",
                deadline.isExpired && sol.estado === "pendiente"
                  ? "border-red-600 bg-red-50/80"
                  : sol.urgencia === "rojo" && sol.estado === "pendiente"
                  ? "border-urgency-red/50 bg-red-50/50"
                  : sol.urgencia === "naranja" && sol.estado === "pendiente"
                  ? "border-urgency-orange/40 bg-orange-50/30"
                  : sol.estado === "fabricado"
                  ? "border-emerald-300/50 bg-emerald-50/30"
                  : ""
              )}
            >
              <CardContent className="p-0">
                <div className="grid gap-4 p-4 lg:grid-cols-[minmax(260px,1.4fr)_minmax(420px,2fr)_auto] lg:items-center">
                  <div className="flex min-w-0 items-start gap-3">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-background ring-1 ring-border">
                      <Droplets className="h-5 w-5 text-muted-foreground" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-mono text-sm font-bold text-foreground">{sol.id}</p>
                        <StatusBadge estado={sol.estado} />
                      </div>
                      <p className="mt-1 truncate text-sm font-semibold text-foreground">{sol.color}</p>
                      <p className="truncate text-xs text-muted-foreground">{sol.serieTinta}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {sol.impresoraNombre} - Cuerpo {sol.cuerpoNumero}
                      </p>
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-[140px_140px_1fr] sm:items-center">
                    <div className="rounded-md border bg-background px-3 py-2">
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Kg a fabricar</p>
                      <p className="font-mono text-2xl font-bold leading-none text-foreground">{formatKg(sol.kgAFabricar)}</p>
                    </div>
                    <div className="rounded-md border bg-background px-3 py-2">
                      <p className={cn(
                        "text-[10px] uppercase tracking-wide",
                        deadline.tone === "expired" ? "text-red-600" : "text-muted-foreground"
                      )}>
                        {deadline.label}
                      </p>
                      <p className={cn(
                        "font-mono text-2xl font-bold leading-none",
                        deadline.tone === "expired" ? "text-red-600" : "text-foreground"
                      )}>
                        {deadline.value}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <div className={cn(
                        "inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs font-semibold",
                        deadlineClass(deadline.tone)
                      )}>
                        <Timer className="h-3.5 w-3.5" />
                        <span>{deadline.isExpired ? "Vencida" : "Cuenta viva"}</span>
                      </div>
                      <UrgencyBadge
                        urgencia={sol.urgencia}
                        pulsing={sol.estado === "pendiente"}
                      />
                      <TechPill icon={Gauge} label="BCM" value={formatNumber(sol.aniloxVolumen, 2)} />
                      <TechPill icon={Layers} label="Anilox" value={sol.aniloxLineatura ? `${sol.aniloxLineatura}` : "--"} />
                      <TechPill icon={Activity} label="Cob." value={`${formatNumber(sol.superficiePorcentaje, 1)}%`} />
                      <TechPill icon={FlaskConical} label="Visc." value={sol.viscosidadActual ? `${sol.viscosidadActual}s` : "--"} tone="amber" />
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-start gap-2 lg:justify-end">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 px-2 text-xs"
                      onClick={() => setExpandedSolicitudId(expandedSolicitudId === sol.id ? null : sol.id)}
                    >
                      Detalle
                      <ChevronDown
                        className={cn(
                          "h-3.5 w-3.5 transition-transform",
                          expandedSolicitudId === sol.id && "rotate-180"
                        )}
                      />
                    </Button>
                    {sol.estado === "pendiente" && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 hover:text-amber-900"
                        onClick={() => handleFabricar(sol.id)}
                      >
                        <PlayCircle className="mr-1 h-4 w-4" />
                        Fabricar
                      </Button>
                    )}
                    {sol.estado === "fabricando" && (
                      <Button
                        size="sm"
                        className="bg-emerald-600 text-white hover:bg-emerald-700"
                        onClick={() => handleOpenFabricado(sol)}
                      >
                        <CheckCircle2 className="mr-1 h-4 w-4" />
                        Fabricado
                      </Button>
                    )}
                    {sol.estado === "fabricado" && (
                      <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-300">
                        Esperando recepcion
                      </Badge>
                    )}
                  </div>
                </div>

                {expandedSolicitudId === sol.id && (
                  <div className="border-t bg-muted/20 p-4">
                    <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
                      <div>
                        <div className="mb-2 flex items-center gap-2">
                          <Gauge className="h-4 w-4 text-muted-foreground" />
                          <h3 className="text-sm font-semibold text-foreground">Detalle tecnico</h3>
                        </div>
                        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                          <DetailMetric label="BCM" value={formatNumber(sol.aniloxVolumen, 2)} />
                          <DetailMetric label="Anilox" value={sol.aniloxLineatura ? `${sol.aniloxLineatura} LPI` : "--"} />
                          <DetailMetric label="Cobertura" value={`${formatNumber(sol.superficiePorcentaje, 1)}%`} />
                          <DetailMetric label="Viscosidad en maquina" value={sol.viscosidadActual ? `${sol.viscosidadActual} s` : "--"} hint="Dato reportado por prensa" />
                        </div>
                      </div>

                      <div>
                        <div className="mb-2 flex items-center gap-2">
                          <Timer className="h-4 w-4 text-muted-foreground" />
                          <h3 className="text-sm font-semibold text-foreground">Produccion</h3>
                        </div>
                        <div className="grid gap-2 sm:grid-cols-2">
                          <DetailMetric label="Metros restantes" value={`${formatNumber(sol.metrosRestantes)} m`} />
                          <DetailMetric label="Ancho impresion" value={`${formatNumber(sol.anchoImpresion * 100, 1)} cm`} />
                          <DetailMetric label="Velocidad" value={sol.velocidadActual ? `${formatNumber(sol.velocidadActual)} m/min` : "--"} />
                          <DetailMetric label="Kg en maquina" value={formatKg(sol.kgEnMaquina)} />
                        </div>
                      </div>
                    </div>

                    {sol.estado === "fabricado" && sol.kgFabricados !== undefined && (
                      <div className="mt-3 inline-flex items-center gap-2 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                        <CheckCircle2 className="h-4 w-4" />
                        <span>Fabricado real:</span>
                        <span className="font-mono font-bold">{formatKg(sol.kgFabricados)}</span>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
            )
          })}
        </div>
      )}

      {/* Dialog para ingresar Kg fabricados */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-foreground">Confirmar Fabricacion</DialogTitle>
          </DialogHeader>
          {selectedSolicitud && (
            <div className="flex flex-col gap-4 py-2">
              <div className="rounded-lg border bg-muted/30 p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-mono text-sm font-semibold text-foreground">{selectedSolicitud.id}</p>
                    <p className="mt-1 text-sm font-semibold text-foreground">{selectedSolicitud.color}</p>
                    <p className="text-xs text-muted-foreground">{selectedSolicitud.serieTinta}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {selectedSolicitud.impresoraNombre} - Cuerpo {selectedSolicitud.cuerpoNumero}
                    </p>
                  </div>
                  <div className="rounded-md border bg-background px-3 py-2 text-right">
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Solicitado</p>
                    <p className="font-mono text-xl font-bold leading-none text-foreground">
                      {formatKg(selectedSolicitud.kgAFabricar)}
                    </p>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  <TechPill icon={Gauge} label="BCM" value={formatNumber(selectedSolicitud.aniloxVolumen, 2)} />
                  <TechPill icon={Layers} label="Anilox" value={selectedSolicitud.aniloxLineatura ? `${selectedSolicitud.aniloxLineatura}` : "--"} />
                  <TechPill icon={Activity} label="Cob." value={`${formatNumber(selectedSolicitud.superficiePorcentaje, 1)}%`} />
                  <TechPill icon={FlaskConical} label="Visc." value={selectedSolicitud.viscosidadActual ? `${selectedSolicitud.viscosidadActual}s` : "--"} tone="amber" />
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="kgFabricados">
                  Kg Realmente Fabricados
                </Label>
                <Input
                  id="kgFabricados"
                  type="number"
                  step="0.1"
                  value={kgFabricados}
                  onChange={(e) => setKgFabricados(e.target.value)}
                  className="font-mono"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={handleConfirmFabricado}
              className="bg-emerald-600 text-white hover:bg-emerald-700"
            >
              Confirmar Fabricado
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
