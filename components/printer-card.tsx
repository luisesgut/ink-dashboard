"use client"

import Link from "next/link"
import { cn } from "@/lib/utils"
import type { Impresora } from "@/lib/mock-data"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Printer, Pause, RotateCcw, Bell, Gauge, Layers } from "lucide-react"

const estadoConfig = {
  activa: {
    label: "Activa",
    badgeClass: "bg-emerald-500/10 text-emerald-600 border-emerald-300 dark:text-emerald-400",
    borderClass: "border-l-emerald-500",
    dotClass: "bg-emerald-500",
    icon: Printer,
  },
  parada: {
    label: "Parada",
    badgeClass: "bg-red-500/10 text-red-600 border-red-300 dark:text-red-400",
    borderClass: "border-l-red-500",
    dotClass: "bg-red-500",
    icon: Pause,
  },
  cambio: {
    label: "Cambio",
    badgeClass: "bg-amber-500/10 text-amber-600 border-amber-300 dark:text-amber-400",
    borderClass: "border-l-amber-500",
    dotClass: "bg-amber-500",
    icon: RotateCcw,
  },
}

function formatNumber(n: number): string {
  return new Intl.NumberFormat("es-MX").format(n)
}

function ProgresoCircular({ value }: { value: number }) {
  const r = 18
  const circ = 2 * Math.PI * r
  const offset = circ - (value / 100) * circ
  return (
    <div className="relative flex items-center justify-center">
      <svg width="48" height="48" className="-rotate-90">
        <circle cx="24" cy="24" r={r} stroke="currentColor" strokeWidth="4" fill="none" className="text-muted/20" />
        <circle
          cx="24"
          cy="24"
          r={r}
          stroke="currentColor"
          strokeWidth="4"
          fill="none"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className="text-primary transition-all duration-500"
        />
      </svg>
      <span className="absolute text-[11px] font-bold text-foreground">{value}%</span>
    </div>
  )
}

export function PrinterCard({
  impresora,
  solicitudesPendientes,
  tieneNotificacion,
  printCard,
  tieneDatos,
}: {
  impresora: Impresora
  solicitudesPendientes?: number
  tieneNotificacion?: boolean
  printCard?: string
  tieneDatos?: boolean
}) {
  const config = estadoConfig[impresora.estado]
  const IconEstado = config.icon
  const pendientes = solicitudesPendientes ?? impresora.solicitudesPendientes
  const notif = tieneNotificacion ?? impresora.tieneNotificacion
  const trabajo = impresora.trabajoActual
  const progreso = trabajo?.porcentaje ?? 0
  const velocidad = trabajo?.velocidadActual ?? 0

  return (
    <Link href={`/maquina/${impresora.id}`} className="block outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-xl">
      <div
        className={cn(
          "group relative rounded-xl border bg-card border-l-4 transition-all duration-200",
          "hover:shadow-md hover:shadow-black/5 dark:hover:shadow-black/20",
          "hover:-translate-y-0.5 cursor-pointer",
          config.borderClass,
          notif && "ring-1 ring-urgency-red/40"
        )}
      >
        {/* Notification ping */}
        {notif && (
          <span className="absolute -right-1.5 -top-1.5 flex h-5 w-5 z-10">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-urgency-red opacity-60" />
            <span className="relative inline-flex h-5 w-5 items-center justify-center rounded-full bg-urgency-red shadow">
              <Bell className="h-2.5 w-2.5 text-white" />
            </span>
          </span>
        )}

        <div className="p-4 flex flex-col gap-3">
          {/* Header row */}
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className={cn("mt-0.5 h-2 w-2 flex-shrink-0 rounded-full", config.dotClass)} />
              <h3 className="text-sm font-bold text-foreground truncate leading-tight">
                {impresora.nombre}
              </h3>
            </div>
            <Badge
              variant="outline"
              className={cn("flex-shrink-0 text-[10px] font-semibold uppercase gap-1 px-1.5", config.badgeClass)}
            >
              <IconEstado className="h-2.5 w-2.5" />
              {config.label}
            </Badge>
          </div>

          {/* Body */}
          {trabajo ? (
            <>
              {/* Job info */}
              <div className="space-y-0.5 min-w-0">
                <p className="text-[10px] text-muted-foreground font-mono tracking-wide uppercase">
                  {trabajo.ordenProduccion}
                </p>
                <p className="text-xs font-semibold text-foreground truncate leading-tight">
                  {trabajo.producto}
                </p>
              </div>

              {/* Progress section */}
              <div className="flex items-center gap-3">
                <ProgresoCircular value={progreso} />
                <div className="flex-1 min-w-0 space-y-1">
                  <Progress value={progreso} className="h-1.5 bg-muted/40" />
                  <p className="text-[10px] text-muted-foreground">
                    <span className="font-semibold text-foreground">{formatNumber(trabajo.metrosRestantes)} m</span>
                    {" "}<span className="text-muted-foreground/60">restantes</span>
                  </p>
                  <p className="text-[10px] text-muted-foreground/70">
                    de {formatNumber(trabajo.metrosTotales)} m totales
                  </p>
                </div>
              </div>

              {/* Footer row */}
              <div className="flex items-center justify-between gap-2 pt-1 border-t border-border/60">
                <div className="flex items-center gap-2">
                  <Badge
                    variant="secondary"
                    className="text-[9px] uppercase font-semibold px-1.5 py-0.5 h-auto"
                  >
                    <Layers className="h-2.5 w-2.5 mr-0.5" />
                    {impresora.sistema}
                  </Badge>
                  {velocidad > 0 && (
                    <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
                      <Gauge className="h-3 w-3" />
                      {formatNumber(velocidad)} m/h
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  {printCard && (
                    <span className={cn(
                      "text-[9px] font-semibold rounded px-1 py-0.5",
                      tieneDatos
                        ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                        : "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                    )}>
                      {tieneDatos ? "✓ Print" : "⚠ Print"}
                    </span>
                  )}
                  {pendientes > 0 && (
                    <Badge className="bg-urgency-red text-white text-[9px] h-4 min-w-4 flex items-center justify-center px-1">
                      {pendientes}
                    </Badge>
                  )}
                </div>
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center py-5 gap-2 text-muted-foreground">
              <RotateCcw className="h-7 w-7 opacity-30 animate-spin" />
              <p className="text-xs font-medium">Sin trabajo activo</p>
            </div>
          )}
        </div>
      </div>
    </Link>
  )
}
