"use client"

import { useEffect, useRef, useState } from "react"
import { useInkStore } from "@/lib/store"
import type { SolicitudTinta } from "@/lib/mock-data"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { UrgencyBadge } from "@/components/urgency-badge"
import { StatusBadge } from "@/components/status-badge"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { FlaskConical, PlayCircle, CheckCircle2, Clock, Droplets } from "lucide-react"
import { toast } from "sonner"

const urgenciaOrden = { rojo: 0, naranja: 1, verde: 2 }
const estadoOrden = { pendiente: 0, fabricando: 1, fabricado: 2, entregado: 3 }

export default function CocinaPage() {
  const { solicitudes, marcarFabricando, marcarFabricado } = useInkStore()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [selectedSolicitud, setSelectedSolicitud] = useState<SolicitudTinta | null>(null)
  const [kgFabricados, setKgFabricados] = useState("")
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
    return () => {
      audioContextRef.current?.close().catch(() => {})
      audioContextRef.current = null
    }
  }, [])

  const solicitudesActivas = [...solicitudes]
    .filter((s) => s.estado !== "entregado")
    .sort(
      (a, b) =>
        estadoOrden[a.estado] - estadoOrden[b.estado] ||
        urgenciaOrden[a.urgencia] - urgenciaOrden[b.urgencia]
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
          {solicitudesActivas.map((sol) => (
            <Card
              key={sol.id}
              className={
                sol.urgencia === "rojo" && sol.estado === "pendiente"
                  ? "border-urgency-red/50 bg-red-50/50"
                  : sol.urgencia === "naranja" && sol.estado === "pendiente"
                  ? "border-urgency-orange/40 bg-orange-50/30"
                  : sol.estado === "fabricado"
                  ? "border-emerald-300/50 bg-emerald-50/30"
                  : ""
              }
            >
              <CardContent className="p-4">
                <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
                  {/* Info */}
                  <div className="flex items-center gap-3 min-w-48">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
                      <Droplets className="h-5 w-5 text-muted-foreground" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-foreground">
                        {sol.id}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {sol.impresoraNombre} - Cuerpo {sol.cuerpoNumero}
                      </p>
                    </div>
                  </div>

                  {/* Color */}
                  <div className="min-w-28">
                    <p className="text-[10px] uppercase text-muted-foreground">Color</p>
                    <p className="text-sm font-semibold text-foreground">{sol.color}</p>
                    <p className="text-[10px] text-muted-foreground">{sol.serieTinta}</p>
                  </div>

                  {/* Kg */}
                  <div className="min-w-20">
                    <p className="text-[10px] uppercase text-muted-foreground">Kg a Fabricar</p>
                    <p className="text-lg font-bold font-mono text-foreground">{sol.kgAFabricar}</p>
                  </div>

                  {/* Tiempo */}
                  <div className="min-w-24">
                    <p className="text-[10px] uppercase text-muted-foreground">Tiempo</p>
                    <p className="text-lg font-bold font-mono text-foreground">
                      {sol.tiempoEstimadoMin === 999 ? "--" : `${sol.tiempoEstimadoMin}min`}
                    </p>
                  </div>

                  {/* Urgencia */}
                  <UrgencyBadge
                    urgencia={sol.urgencia}
                    tiempoMin={sol.tiempoEstimadoMin === 999 ? undefined : sol.tiempoEstimadoMin}
                    pulsing={sol.estado === "pendiente"}
                  />

                  {/* Estado */}
                  <StatusBadge estado={sol.estado} />

                  {/* Kg fabricados (solo si fabricado) */}
                  {sol.estado === "fabricado" && sol.kgFabricados !== undefined && (
                    <div className="min-w-20">
                      <p className="text-[10px] uppercase text-muted-foreground">Kg Fabricados</p>
                      <p className="text-lg font-bold font-mono text-emerald-600">{sol.kgFabricados}</p>
                    </div>
                  )}

                  {/* Actions */}
                  <div className="ml-auto flex items-center gap-2">
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
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Dialog para ingresar Kg fabricados */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-foreground">Confirmar Fabricacion</DialogTitle>
          </DialogHeader>
          {selectedSolicitud && (
            <div className="flex flex-col gap-4 py-2">
              <div className="rounded-lg bg-muted p-3">
                <p className="text-sm text-foreground">
                  <span className="font-semibold">{selectedSolicitud.id}</span> -{" "}
                  {selectedSolicitud.color}
                </p>
                <p className="text-xs text-muted-foreground">
                  {selectedSolicitud.impresoraNombre} - Cuerpo{" "}
                  {selectedSolicitud.cuerpoNumero}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Kg solicitados:{" "}
                  <span className="font-mono font-bold text-foreground">
                    {selectedSolicitud.kgAFabricar}
                  </span>
                </p>
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
