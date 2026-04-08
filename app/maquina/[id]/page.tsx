"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { useInkStore } from "@/lib/store"
import { useTableroHub } from "@/lib/tablero-hub"
import { machineIdToPrensa, normalizePrensaCode, parseCantidadPorUnidad } from "@/lib/tablero-mappers"
import { calcularTiempoMinutos, determinarUrgencia } from "@/lib/mock-data"
import { getPrintCard, getTinta, calcularKgPorColor, calcularTiempoPorTinta, type KgPorColor } from "@/lib/pocketbase"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
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
import {
  ArrowLeft, Droplets, Gauge, LoaderCircle, Ruler, Printer, Send, ExternalLink, FileText,
  ZoomIn, ZoomOut, Maximize2, RotateCcw
} from "lucide-react"
import { toast } from "sonner"

const KG_BASE_MAQUINA: Record<string, number> = {
  "I01-BOBST 1": 20, "I02-BOBST 2": 20, "I03-VISION 4": 10,
  "I04-VISION 3": 10, "I05-VISION 2": 10, "I06-BOBST 3": 20,
  "I07-VISION 1": 10, "I08-SCHIAVI": 20,
}

// Estado editable por fila de color
interface FilaColor extends KgPorColor {
  kgEnMaquina: string   // lo ingresa el operador
  viscosidad: string    // lo ingresa el operador
  enviando: boolean
}

interface ValidationWarning {
  color: string
  campos: string[]
}

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

  // Velocidad — el operador la ingresa una sola vez
  const [velocidad, setVelocidad] = useState("")

  // Colores cargados del Print Card
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

  const solicitudesMaquina = getSolicitudesPorMaquina(normalizedId).filter(s => s.estado !== "entregado")
  const notificacionesMaquina = getNotificacionesPorMaquina(normalizedId).filter(n => !n.leida)

  const cargarColores = useCallback(async (pc: string, metros: number) => {
    if (!pc) return
    const requestId = ++loadRequestRef.current
    setLoadingPC(true)

    console.log("API_URL:", process.env.NEXT_PUBLIC_API_URL)
    console.log("Fetching PrintCard:", pc)

    // Jalar colores del endpoint .NET (fuente de verdad)
    let coloresAPI: { pantone: string, cobertura: number, orden: number }[] = []
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/PrintCardTintas/${encodeURIComponent(pc)}`)
      console.log("API response status:", res.status)
      if (res.ok) coloresAPI = await res.json()
      console.log("Colores API:", coloresAPI)
    } catch (e) {
      console.error("Error fetching colores API:", e)
    }

    if (!coloresAPI.length) {
      setFilas([])
      setLoadingPC(false)
      return
    }

    // Ancho y máquina siguen viniendo de PocketBase
    const pcData = await getPrintCard(pc)
    if (requestId !== loadRequestRef.current) return

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

      const { kgBruto, kgTinta, kgDisolvente } = calcularKgPorColor(
        metros, anchoVal, bcm, densidad, cobertura, kgBase
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
        kgEnMaquina: "",
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
  }, [normalizedId])

  // Cargar cuando llega el Print Card del hub
  useEffect(() => {
    if (printCard) {
      void cargarColores(printCard, metrosRestantes)
      return
    }
    loadRequestRef.current += 1
    setFilas([])
    setLoadingPC(false)
    setAnchoCm(0)
    setMaquinaNombre("")
  }, [printCard, metrosRestantes, cargarColores])

  // Recalcular kg cuando cambia la velocidad (no afecta kg, solo urgencia)
  // Recalcular kg de una fila cuando se edita BCM, densidad, cobertura
  function actualizarFila(index: number, campo: keyof FilaColor, valor: string) {
    setFilas(prev => {
      const nuevas = [...prev]
      const fila = { ...nuevas[index], [campo]: valor }

      // Recalcular kg si cambian cualquier parámetro que afecta el cálculo
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
      setValidationWarning({
        color: fila.color,
        campos: faltantes,
      })
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

  if (cargando) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <LoaderCircle className="h-10 w-10 animate-spin" />
          <p className="text-sm">Cargando datos de la prensa...</p>
        </div>
      </div>
    )
  }

  if (!tableroActual) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-muted-foreground">No hay datos para esta prensa en el hub</p>
      </div>
    )
  }

  const velNum = parseFloat(velocidad) || 0
  const tiempoMin = velNum > 0 ? calcularTiempoMinutos(metrosRestantes, velNum) : null
  const urgencia = tiempoMin !== null ? determinarUrgencia(tiempoMin) : null

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-center gap-3">
          <Link href="/">
            <Button variant="ghost" size="icon" className="shrink-0">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-2xl font-bold text-foreground">{nombreMaquina}</h2>
              <Badge
                variant="outline"
                className={estado === "activa"
                  ? "bg-emerald-100 text-emerald-800 border-emerald-300"
                  : "bg-amber-100 text-amber-800 border-amber-300"}
              >
                {estado === "activa" ? "Activa" : "Cambio"}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              {tableroActual.orden} · {tableroActual.producto}
            </p>
            {printCard && (
              <p className="text-xs font-mono text-muted-foreground">
                Print Card: <span className="font-bold text-foreground">{printCard}</span>
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              Hub: {connectionState}{error ? ` · ${error}` : ""}
            </p>
          </div>
        </div>
      </div>

      {/* Métricas */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Progreso</CardTitle>
            <Printer className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="mb-2 text-2xl font-bold font-mono text-foreground">{progreso}%</div>
            <Progress value={progreso} className="h-2" />
            <p className="mt-1 text-xs text-muted-foreground">{metrosRestantes.toLocaleString()}m restantes</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Metros Totales</CardTitle>
            <Ruler className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-foreground">{metrosTotales.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">metros lineales</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Velocidad Actual</CardTitle>
            <Gauge className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <Input
              type="number"
              placeholder="m/min"
              value={velocidad}
              onChange={e => setVelocidad(e.target.value)}
              className="text-2xl font-bold font-mono h-10"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              {tiempoMin !== null && tiempoMin !== 999
                ? <>Tiempo restante: <span className="font-medium">{tiempoMin} min</span></>
                : "ingresa para calcular urgencia"}
            </p>
          </CardContent>
        </Card>
        {/* Print Card preview */}
        <Card className="overflow-hidden">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
              <FileText className="h-4 w-4" />
              Print Card
            </CardTitle>
            {printCard && (
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon" className="h-6 w-6" title="Ver en pantalla completa"
                  onClick={() => { setPcZoom(1); setPcModalOpen(true) }}>
                  <Maximize2 className="h-3.5 w-3.5" />
                </Button>
                <a href={`http://172.16.10.31/api/Printcard/${printCard}`} target="_blank" rel="noopener noreferrer">
                  <Button variant="ghost" size="icon" className="h-6 w-6" title="Abrir en nueva pestaña">
                    <ExternalLink className="h-3.5 w-3.5" />
                  </Button>
                </a>
              </div>
            )}
          </CardHeader>
          <CardContent className="p-0">
            {printCard ? (
              <button
                className="w-full cursor-zoom-in focus:outline-none"
                onClick={() => { setPcZoom(1); setPcModalOpen(true) }}
                title="Click para ampliar"
              >
                <iframe
                  src={`/api/printcard/${encodeURIComponent(printCard)}`}
                  className="w-full h-36 border-0 pointer-events-none"
                  title={`Print Card ${printCard}`}
                />
              </button>
            ) : (
              <div className="flex items-center justify-center h-36 text-sm text-muted-foreground">
                Sin Print Card asignado
              </div>
            )}
          </CardContent>
        </Card>

        {/* Modal Print Card */}
        <Dialog open={pcModalOpen} onOpenChange={open => { setPcModalOpen(open); if (!open) setPcZoom(1) }}>
          <DialogContent className="max-w-5xl w-[95vw] h-[90vh] flex flex-col p-0 gap-0">
            <DialogHeader className="flex flex-row items-center justify-between px-4 py-3 border-b shrink-0">
              <DialogTitle className="text-sm font-mono">{printCard}</DialogTitle>
              <div className="flex items-center gap-1 mr-8">
                <Button variant="ghost" size="icon" className="h-7 w-7" title="Zoom out"
                  onClick={() => setPcZoom(z => Math.max(0.5, +(z - 0.25).toFixed(2)))}>
                  <ZoomOut className="h-4 w-4" />
                </Button>
                <span className="text-xs font-mono w-10 text-center">{Math.round(pcZoom * 100)}%</span>
                <Button variant="ghost" size="icon" className="h-7 w-7" title="Zoom in"
                  onClick={() => setPcZoom(z => Math.min(4, +(z + 0.25).toFixed(2)))}>
                  <ZoomIn className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7" title="Resetear zoom"
                  onClick={() => setPcZoom(1)}>
                  <RotateCcw className="h-3.5 w-3.5" />
                </Button>
                <a href={`http://172.16.10.31/api/Printcard/${printCard}`} target="_blank" rel="noopener noreferrer">
                  <Button variant="ghost" size="icon" className="h-7 w-7" title="Abrir en nueva pestaña">
                    <ExternalLink className="h-4 w-4" />
                  </Button>
                </a>
              </div>
            </DialogHeader>
            <div
              className="flex-1 overflow-auto"
              onWheel={e => {
                e.preventDefault()
                setPcZoom(z => Math.min(4, Math.max(0.5, +(z + (e.deltaY < 0 ? 0.1 : -0.1)).toFixed(2))))
              }}
            >
              <iframe
                src={`/api/printcard/${encodeURIComponent(printCard)}`}
                title={`Print Card ${printCard}`}
                style={{
                  width: `${100 / pcZoom}%`,
                  height: `${100 / pcZoom}%`,
                  minHeight: "100%",
                  border: "none",
                  transform: `scale(${pcZoom})`,
                  transformOrigin: "top left",
                  display: "block",
                }}
              />
            </div>
          </DialogContent>
        </Dialog>

        {/* Card Ficha Técnica */}
        <Card className="overflow-hidden">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
              <FileText className="h-4 w-4" />
              Ficha Técnica
            </CardTitle>
            {printCard && (
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon" className="h-6 w-6" title="Ver en pantalla completa"
                  onClick={() => { setFichaZoom(1); setFichaModalOpen(true) }}>
                  <Maximize2 className="h-3.5 w-3.5" />
                </Button>
                <a href={`http://172.16.10.31/api/Printcard/ficha/${printCard}`} target="_blank" rel="noopener noreferrer">
                  <Button variant="ghost" size="icon" className="h-6 w-6" title="Abrir en nueva pestaña">
                    <ExternalLink className="h-3.5 w-3.5" />
                  </Button>
                </a>
              </div>
            )}
          </CardHeader>
          <CardContent className="p-0">
            {printCard ? (
              <button
                className="w-full cursor-zoom-in focus:outline-none"
                onClick={() => { setFichaZoom(1); setFichaModalOpen(true) }}
                title="Click para ampliar"
              >
                <iframe
                  src={`/api/printcard/ficha/${encodeURIComponent(printCard)}`}
                  className="w-full h-36 border-0 pointer-events-none"
                  title={`Ficha Técnica ${printCard}`}
                />
              </button>
            ) : (
              <div className="flex items-center justify-center h-36 text-sm text-muted-foreground">
                Sin ficha técnica asignada
              </div>
            )}
          </CardContent>
        </Card>

        {/* Modal Ficha Técnica */}
        <Dialog open={fichaModalOpen} onOpenChange={open => { setFichaModalOpen(open); if (!open) setFichaZoom(1) }}>
          <DialogContent className="max-w-5xl w-[95vw] h-[90vh] flex flex-col p-0 gap-0">
            <DialogHeader className="flex flex-row items-center justify-between px-4 py-3 border-b shrink-0">
              <DialogTitle className="text-sm font-mono">Ficha Técnica · {printCard}</DialogTitle>
              <div className="flex items-center gap-1 mr-8">
                <Button variant="ghost" size="icon" className="h-7 w-7" title="Zoom out"
                  onClick={() => setFichaZoom(z => Math.max(0.5, +(z - 0.25).toFixed(2)))}>
                  <ZoomOut className="h-4 w-4" />
                </Button>
                <span className="text-xs font-mono w-10 text-center">{Math.round(fichaZoom * 100)}%</span>
                <Button variant="ghost" size="icon" className="h-7 w-7" title="Zoom in"
                  onClick={() => setFichaZoom(z => Math.min(4, +(z + 0.25).toFixed(2)))}>
                  <ZoomIn className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7" title="Resetear zoom"
                  onClick={() => setFichaZoom(1)}>
                  <RotateCcw className="h-3.5 w-3.5" />
                </Button>
                <a href={`http://172.16.10.31/api/Printcard/ficha/${printCard}`} target="_blank" rel="noopener noreferrer">
                  <Button variant="ghost" size="icon" className="h-7 w-7" title="Abrir en nueva pestaña">
                    <ExternalLink className="h-4 w-4" />
                  </Button>
                </a>
              </div>
            </DialogHeader>
            <div
              className="flex-1 overflow-auto"
              onWheel={e => {
                e.preventDefault()
                setFichaZoom(z => Math.min(4, Math.max(0.5, +(z + (e.deltaY < 0 ? 0.1 : -0.1)).toFixed(2))))
              }}
            >
              <iframe
                src={`/api/printcard/ficha/${encodeURIComponent(printCard)}`}
                title={`Ficha Técnica ${printCard}`}
                style={{
                  width: `${100 / fichaZoom}%`,
                  height: `${100 / fichaZoom}%`,
                  minHeight: "100%",
                  border: "none",
                  transform: `scale(${fichaZoom})`,
                  transformOrigin: "top left",
                  display: "block",
                }}
              />
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <AlertDialog open={validationWarning !== null} onOpenChange={(open) => {
        if (!open) setValidationWarning(null)
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Faltan datos para calcular la solicitud</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  {validationWarning
                    ? <>Completa estos datos en <strong>{validationWarning.color}</strong> antes de solicitar la tinta:</>
                    : null}
                </p>
                {validationWarning && (
                  <ul className="list-disc space-y-1 pl-5 text-sm text-foreground">
                    {validationWarning.campos.map((campo) => (
                      <li key={campo}>{campo}</li>
                    ))}
                  </ul>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setValidationWarning(null)}>
              Entendido
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Notificaciones */}
      {notificacionesMaquina.length > 0 && (
        <div>
          <h3 className="mb-3 text-lg font-semibold text-foreground">Notificaciones Activas</h3>
          <div className="flex flex-col gap-2">
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
          </div>
        </div>
      )}

      {/* Solicitudes activas */}
      {solicitudesMaquina.length > 0 && (
        <div>
          <h3 className="mb-3 text-lg font-semibold text-foreground">Solicitudes Activas</h3>
          <div className="flex flex-col gap-2">
            {solicitudesMaquina.map(s => (
              <Card key={s.id} className="p-4">
                <div className="flex flex-wrap items-center gap-4">
                  <div>
                    <p className="text-sm font-semibold text-foreground">{s.id} · Cuerpo {s.cuerpoNumero}</p>
                    <p className="text-xs text-muted-foreground">{s.color}</p>
                  </div>
                  <div className="text-sm">
                    <span className="text-muted-foreground">Kg: </span>
                    <span className="font-mono font-semibold">{s.kgAFabricar}</span>
                  </div>
                  <UrgencyBadge urgencia={s.urgencia} tiempoMin={s.tiempoEstimadoMin} />
                  <StatusBadge estado={s.estado} />
                  {s.estado === "fabricado" && (
                    <Button size="sm" onClick={() => confirmarRecepcion(s.id)}>Confirmar Recepción</Button>
                  )}
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Cuerpos Impresores */}
      <div>
        <h3 className="mb-3 text-lg font-semibold text-foreground">Cuerpos Impresores</h3>
        <Card>
          {loadingPC ? (
            <CardContent className="py-10 flex items-center justify-center gap-3 text-muted-foreground">
              <LoaderCircle className="h-5 w-5 animate-spin" />
              <span className="text-sm">Cargando colores del Print Card...</span>
            </CardContent>
          ) : filas.length === 0 ? (
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              {printCard
                ? `No se encontraron colores para ${printCard}`
                : "Sin Print Card asignado a esta orden"}
            </CardContent>
          ) : (
            <div className="overflow-x-auto">
              {(
                <div className="flex items-center gap-3 px-4 py-3 border-b bg-amber-50 dark:bg-amber-950/30">
                  <span className="text-sm text-amber-700 dark:text-amber-400">
                    {anchoCm > 0
                      ? <>Ancho cargado: <strong>{Math.round(anchoCm * 10)} mm</strong> — verificar contra Print Card y corregir si es necesario:</>
                      : "Ancho de bobina no disponible — ingrésalo en mm (ej: 584):"}
                  </span>
                  <Input
                    type="number"
                    placeholder="mm"
                    className="w-24 h-8 text-sm font-mono"
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
                  <span className="text-sm text-muted-foreground">mm</span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
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
              )}
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="px-4 py-3 text-left font-medium">#</th>
                    <th className="px-4 py-3 text-left font-medium">Color</th>
                    <th className="px-4 py-3 text-right font-medium">Anilox (LPI)</th>
                    <th className="px-4 py-3 text-right font-medium">BCM (cm³/m²)</th>
                    <th className="px-4 py-3 text-right font-medium">Densidad</th>
                    <th className="px-4 py-3 text-right font-medium">Cob. %</th>
                    <th className="px-4 py-3 text-right font-medium">Kg calculados</th>
                    <th className="px-4 py-3 text-right font-medium">Kg en máquina</th>
                    <th className="px-4 py-3 text-right font-medium">Viscosidad</th>
                    <th className="px-4 py-3 text-center font-medium">Urgencia</th>
                    <th className="px-4 py-3 text-right font-medium">Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {filas.map((fila, i) => (
                    <tr key={i} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="px-4 py-3 font-mono font-bold text-foreground">{i + 1}</td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-foreground">{fila.color}</div>
                        <div className="text-xs text-muted-foreground">{fila.tinta}</div>
                      </td>
                      {/* Anilox editable */}
                      <td className="px-4 py-3 text-right">
                        <Input
                          type="number"
                          value={fila.anilox || ""}
                          onChange={e => actualizarFila(i, "anilox", e.target.value)}
                          className="w-20 text-right font-mono text-sm h-8 ml-auto"
                          placeholder="LPI"
                        />
                      </td>
                      {/* BCM editable */}
                      <td className="px-4 py-3 text-right">
                        <Input
                          type="number"
                          step="0.1"
                          value={fila.bcm || ""}
                          onChange={e => actualizarFila(i, "bcm", e.target.value)}
                          className={`w-20 text-right font-mono text-sm h-8 ml-auto ${!fila.bcm ? "border-amber-400 dark:border-amber-600" : ""}`}
                          placeholder="BCM"
                        />
                      </td>
                      {/* Densidad editable */}
                      <td className="px-4 py-3 text-right">
                        <Input
                          type="number"
                          step="0.01"
                          value={fila.densidad || ""}
                          onChange={e => actualizarFila(i, "densidad", e.target.value)}
                          className={`w-20 text-right font-mono text-sm h-8 ml-auto ${!fila.densidad ? "border-amber-400 dark:border-amber-600" : ""}`}
                          placeholder="g/cm³"
                        />
                      </td>
                      {/* Cobertura editable */}
                      <td className="px-4 py-3 text-right">
                        <Input
                          type="number"
                          step="0.1"
                          value={fila.cobertura ? (fila.cobertura * 100).toFixed(1) : ""}
                          onChange={e => actualizarFila(i, "cobertura", String(parseFloat(e.target.value) / 100 || 0))}
                          className="w-20 text-right font-mono text-sm h-8 ml-auto"
                          placeholder="%"
                        />
                      </td>
                      {/* Kg calculados */}
                      <td className="px-4 py-3 text-right">
                        {fila.kgBruto > 0 ? (
                          <div className="flex flex-col items-end gap-0.5">
                            <span className="font-mono font-bold text-foreground">{fila.kgBruto} kg</span>
                            {fila.kgTinta < fila.kgBruto && (
                              <span className="text-xs text-muted-foreground">
                                pedir: {fila.kgTinta} kg
                              </span>
                            )}
                          </div>
                        ) : (!fila.bcm || !fila.densidad) ? (
                          <span className="text-xs text-amber-600 dark:text-amber-400" title="Ingresa BCM y densidad para calcular">
                            Falta BCM/densidad
                          </span>
                        ) : (
                          <span className="font-mono font-bold text-muted-foreground">—</span>
                        )}
                      </td>
                      {/* Kg en máquina — operador */}
                      <td className="px-4 py-3 text-right">
                        {(() => {
                          const val = parseFloat(fila.kgEnMaquina) || 0
                          const excede = fila.kgBruto > 0 && val > fila.kgBruto
                          return (
                            <>
                              <Input
                                type="number"
                                step="0.1"
                                value={fila.kgEnMaquina}
                                onChange={e => actualizarFila(i, "kgEnMaquina", e.target.value)}
                                className={`w-20 text-right font-mono text-sm h-8 ml-auto ${excede ? "border-red-500 focus-visible:ring-red-500" : ""}`}
                                placeholder="kg"
                              />
                              {excede && (
                                <p className="mt-0.5 text-xs text-red-500">máx {fila.kgBruto} kg</p>
                              )}
                            </>
                          )
                        })()}
                      </td>
                      {/* Viscosidad — operador */}
                      <td className="px-4 py-3 text-right">
                        <Input
                          type="number"
                          value={fila.viscosidad}
                          onChange={e => actualizarFila(i, "viscosidad", e.target.value)}
                          className="w-20 text-right font-mono text-sm h-8 ml-auto"
                          placeholder="seg"
                        />
                      </td>
                      {/* Urgencia por color */}
                      <td className="px-4 py-3 text-center">
                        {fila.kgEnMaquina && velocidad && fila.bcm ? (() => {
                          const t = calcularTiempoPorTinta(
                            parseFloat(fila.kgEnMaquina) || 0,
                            parseFloat(velocidad) || 0,
                            anchoCm, fila.bcm, fila.densidad, fila.cobertura
                          )
                          const u = determinarUrgencia(t)
                          return <UrgencyBadge urgencia={u} tiempoMin={t === 999 ? undefined : t} pulsing />
                        })() : <span className="text-xs text-muted-foreground">—</span>}
                      </td>
                      {/* Solicitar */}
                      <td className="px-4 py-3 text-right">
                        <Button
                          size="sm"
                          onClick={() => solicitarColor(i)}
                          disabled={fila.enviando}
                        >
                          {fila.enviando
                            ? <LoaderCircle className="h-3 w-3 animate-spin" />
                            : <><Send className="mr-1 h-3 w-3" />Solicitar</>}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}
