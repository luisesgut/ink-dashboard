"use client"

import { useState } from "react"
import { useInkStore } from "@/lib/store"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { FlashingAlert } from "@/components/flashing-alert"
import { Bell, BellOff, CheckCircle, Filter } from "lucide-react"
import { toast } from "sonner"

export default function NotificacionesPage() {
  const {
    notificaciones,
    impresoras,
    confirmarRecepcion,
    marcarNotificacionLeida,
    marcarTodasLeidas,
    getNotificacionesSinLeer,
  } = useInkStore()
  const [filtroMaquina, setFiltroMaquina] = useState<string>("todas")

  const sinLeer = getNotificacionesSinLeer()

  const notificacionesFiltradas =
    filtroMaquina === "todas"
      ? notificaciones
      : notificaciones.filter((n) => n.impresoraId === filtroMaquina)

  function handleConfirmarRecepcion(notifId: string, solicitudId: string) {
    confirmarRecepcion(solicitudId)
    marcarNotificacionLeida(notifId)
    toast.success("Recepcion confirmada", {
      description: "La tinta ha sido recibida y registrada en el historial",
    })
  }

  function handleMarcarTodasLeidas() {
    marcarTodasLeidas()
    toast.success("Todas las notificaciones marcadas como leidas")
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground">
            Notificaciones
          </h2>
          <p className="text-sm text-muted-foreground">
            Alertas de estado de solicitudes de tinta
          </p>
        </div>
        <div className="flex items-center gap-2">
          {sinLeer > 0 && (
            <Badge className="bg-urgency-red text-white">
              {sinLeer} sin leer
            </Badge>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={handleMarcarTodasLeidas}
            disabled={sinLeer === 0}
          >
            <CheckCircle className="mr-1 h-3 w-3" />
            Marcar todas leidas
          </Button>
        </div>
      </div>

      {/* Filtro */}
      <div className="flex items-center gap-2">
        <Filter className="h-4 w-4 text-muted-foreground" />
        <Select value={filtroMaquina} onValueChange={setFiltroMaquina}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Filtrar por maquina" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todas las maquinas</SelectItem>
            {impresoras.map((imp) => (
              <SelectItem key={imp.id} value={imp.id}>
                {imp.nombre}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Notifications list */}
      {notificacionesFiltradas.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <BellOff className="mb-3 h-12 w-12 opacity-30" />
            <p className="text-lg font-medium">Sin notificaciones</p>
            <p className="text-sm">No hay alertas para esta maquina</p>
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {notificacionesFiltradas.map((notif) => (
            <div key={notif.id} className="flex items-start gap-3">
              <div className="flex-1">
                <FlashingAlert
                  tipo={notif.tipo}
                  mensaje={notif.mensaje}
                  timestamp={notif.timestamp}
                  leida={notif.leida}
                />
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1 pt-4">
                <Badge variant="outline" className="text-[10px]">
                  {notif.impresoraNombre}
                </Badge>
                <span className="text-[10px] text-muted-foreground">
                  {notif.solicitudId}
                </span>
                {notif.tipo === "fabricado" && !notif.leida && (
                  <Button
                    size="sm"
                    variant="default"
                    className="mt-1"
                    onClick={() => handleConfirmarRecepcion(notif.id, notif.solicitudId)}
                  >
                    <CheckCircle className="mr-1 h-3 w-3" />
                    Confirmar Recepcion
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Legend */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm text-muted-foreground">
            Guia de Alertas
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
              <Bell className="h-5 w-5 text-amber-600" />
              <div>
                <p className="text-sm font-semibold text-amber-800">FABRICANDO</p>
                <p className="text-xs text-amber-700">
                  La tinta se esta preparando en cocina
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
              <CheckCircle className="h-5 w-5 text-emerald-600" />
              <div>
                <p className="text-sm font-semibold text-emerald-800">
                  FABRICADO (destellante)
                </p>
                <p className="text-xs text-emerald-700">
                  Tinta lista - Presiona Confirmar para registrar recepcion
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
