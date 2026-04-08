"use client"

import Link from "next/link"
import { cn } from "@/lib/utils"
import type { Impresora } from "@/lib/mock-data"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Printer, Pause, RotateCcw, Bell } from "lucide-react"

const estadoConfig = {
  activa: { label: "Activa", className: "bg-emerald-100 text-emerald-800 border-emerald-300", icon: Printer },
  parada: { label: "Parada", className: "bg-red-100 text-red-800 border-red-300", icon: Pause },
  cambio: { label: "Cambio", className: "bg-amber-100 text-amber-800 border-amber-300", icon: RotateCcw },
}

function formatNumber(n: number): string {
  return new Intl.NumberFormat("en-US").format(n)
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
  const progreso = impresora.trabajoActual?.porcentaje ?? 0

  return (
    <Link href={`/maquina/${impresora.id}`}>
      <Card
        className={cn(
          "group relative cursor-pointer transition-all hover:shadow-lg hover:border-primary/40",
          notif && "ring-2 ring-urgency-red/50"
        )}
      >
        {notif && (
          <span className="absolute -right-1 -top-1 flex h-4 w-4">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-urgency-red opacity-75" />
            <span className="relative inline-flex h-4 w-4 items-center justify-center rounded-full bg-urgency-red">
              <Bell className="h-2.5 w-2.5 text-white" />
            </span>
          </span>
        )}

        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-base font-bold text-foreground">{impresora.nombre}</CardTitle>
          <div className="flex flex-col items-end gap-1">
            <Badge
              variant="outline"
              className={cn("text-[10px] font-semibold uppercase", config.className)}
            >
              <IconEstado className="mr-1 h-3 w-3" />
              {config.label}
            </Badge>
            {printCard && (
              <span className={`text-[10px] font-mono ${tieneDatos ? "text-emerald-600" : "text-amber-500"}`}>
                {tieneDatos ? "✓ Con datos" : "⚠ Sin datos"}
              </span>
            )}
          </div>
        </CardHeader>

        <CardContent className="flex flex-col gap-3">
          {impresora.trabajoActual ? (
            <>
              <div>
                <p className="text-xs font-medium text-muted-foreground">
                  {impresora.trabajoActual.ordenProduccion}
                </p>
                <p className="text-sm font-semibold text-foreground truncate">
                  {impresora.trabajoActual.producto}
                </p>
              </div>

              <div>
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Progreso</span>
                  <span className="font-mono font-semibold text-foreground">{progreso}%</span>
                </div>
                <Progress value={progreso} className="h-2" />
                <p className="mt-1 text-[10px] text-muted-foreground">
                  {formatNumber(impresora.trabajoActual.metrosRestantes)}m restantes de{" "}
                  {formatNumber(impresora.trabajoActual.metrosTotales)}m
                </p>
              </div>

              <div className="flex items-center justify-between">
                <Badge variant="secondary" className="text-[10px] uppercase">
                  {impresora.sistema}
                </Badge>
                {pendientes > 0 && (
                  <Badge className="bg-urgency-red text-white text-[10px]">
                    {pendientes} solicitud{pendientes > 1 ? "es" : ""}
                  </Badge>
                )}
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center py-4 text-muted-foreground">
              <RotateCcw className="mb-2 h-8 w-8 animate-spin opacity-40" />
              <p className="text-sm">En cambio de trabajo</p>
            </div>
          )}
        </CardContent>
      </Card>
    </Link>
  )
}