"use client"

import { useCallback, useEffect, useState } from "react"
import {
  getPendingInkReturns,
  getConfirmedInkReturns,
  confirmInkReturn,
  type InkReturn,
} from "@/lib/pocketbase"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { CocinaNav } from "@/components/cocina-nav"
import { CheckCircle2, Clock, LoaderCircle, PackageCheck, Undo2 } from "lucide-react"
import { toast } from "sonner"

function formatMachineId(machineId: string): string {
  return machineId
    .split("-")
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

function formatTime(dateStr: string): string {
  if (!dateStr) return "—"
  try {
    return new Date(dateStr.replace(" ", "T")).toLocaleTimeString("es-MX", {
      hour: "2-digit",
      minute: "2-digit",
    })
  } catch {
    return dateStr
  }
}

export default function DevolucionesPage() {
  const [pending, setPending] = useState<InkReturn[]>([])
  const [confirmed, setConfirmed] = useState<InkReturn[]>([])
  const [confirming, setConfirming] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async () => {
    const [pendingData, confirmedData] = await Promise.all([
      getPendingInkReturns(),
      getConfirmedInkReturns(),
    ])
    setPending(pendingData)
    setConfirmed(confirmedData)
    setLoading(false)
  }, [])

  useEffect(() => {
    void fetchData()
    const interval = setInterval(() => void fetchData(), 5000)
    return () => clearInterval(interval)
  }, [fetchData])

  async function handleConfirm(inkReturn: InkReturn) {
    setConfirming(prev => new Set(prev).add(inkReturn.id))
    try {
      const result = await confirmInkReturn(inkReturn.id)
      if (result) {
        toast.success("Recepción confirmada", {
          description: `${inkReturn.pantone} · ${inkReturn.kg_disponibles} kg`,
        })
        void fetchData()
      } else {
        toast.error("Error al confirmar la recepción")
      }
    } finally {
      setConfirming(prev => {
        const next = new Set(prev)
        next.delete(inkReturn.id)
        return next
      })
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <CocinaNav />

      <div>
        <h2 className="text-2xl font-bold text-foreground">Devoluciones de Tinta</h2>
        <p className="text-sm text-muted-foreground">
          Devoluciones pendientes de confirmación por cocina
        </p>
      </div>

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="border-amber-300/50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Pendientes</CardTitle>
            <Clock className="h-4 w-4 text-amber-600" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold font-mono text-amber-600">{pending.length}</div>
          </CardContent>
        </Card>
        <Card className="border-emerald-300/50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Confirmadas (24h)</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold font-mono text-emerald-600">{confirmed.length}</div>
          </CardContent>
        </Card>
      </div>

      {/* Pending section */}
      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
          <Clock className="h-4 w-4 text-amber-600" />
          Pendientes de confirmación
        </h3>

        {loading ? (
          <Card>
            <CardContent className="flex items-center justify-center gap-3 py-10 text-muted-foreground">
              <LoaderCircle className="h-5 w-5 animate-spin text-primary/50" />
              <span className="text-sm">Cargando…</span>
            </CardContent>
          </Card>
        ) : pending.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-10 text-muted-foreground">
              <Undo2 className="mb-3 h-10 w-10 opacity-30" />
              <p className="text-sm font-medium">Sin devoluciones pendientes</p>
            </CardContent>
          </Card>
        ) : (
          <div className="flex flex-col gap-3">
            {pending.map(ret => (
              <Card key={ret.id} className="border-amber-300/40 bg-amber-50/30 dark:bg-amber-900/10">
                <CardContent className="p-4">
                  <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
                    <div className="flex items-center gap-3 min-w-48">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-100 dark:bg-amber-900/30">
                        <Undo2 className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                      </div>
                      <div>
                        <p className="text-sm font-bold text-foreground">{formatMachineId(ret.machine_id)}</p>
                        <p className="text-xs text-muted-foreground">{formatTime(ret.created)}</p>
                      </div>
                    </div>

                    <div className="min-w-28">
                      <p className="text-[10px] uppercase text-muted-foreground">Pantone</p>
                      <p className="text-sm font-semibold text-foreground">{ret.pantone}</p>
                    </div>

                    <div className="min-w-20">
                      <p className="text-[10px] uppercase text-muted-foreground">Kg disponibles</p>
                      <p className="text-lg font-bold font-mono text-foreground">{ret.kg_disponibles}</p>
                    </div>

                    <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-300 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-700">
                      Pendiente
                    </Badge>

                    <div className="ml-auto">
                      <Button
                        size="sm"
                        className="bg-emerald-600 text-white hover:bg-emerald-700"
                        onClick={() => void handleConfirm(ret)}
                        disabled={confirming.has(ret.id)}
                      >
                        {confirming.has(ret.id)
                          ? <LoaderCircle className="mr-1 h-4 w-4 animate-spin" />
                          : <CheckCircle2 className="mr-1 h-4 w-4" />}
                        Confirmar recepción
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* Confirmed section */}
      {!loading && confirmed.length > 0 && (
        <section className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
            <PackageCheck className="h-4 w-4 text-emerald-600" />
            Confirmadas últimas 24 horas
          </h3>
          <div className="flex flex-col gap-2">
            {confirmed.map(ret => (
              <Card key={ret.id} className="border-emerald-300/30 bg-emerald-50/20 dark:bg-emerald-900/10">
                <CardContent className="p-4">
                  <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                    <div className="flex items-center gap-3 min-w-48">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-100 dark:bg-emerald-900/30">
                        <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-foreground">{formatMachineId(ret.machine_id)}</p>
                        <p className="text-xs text-muted-foreground">{formatTime(ret.updated)}</p>
                      </div>
                    </div>

                    <div className="min-w-28">
                      <p className="text-[10px] uppercase text-muted-foreground">Pantone</p>
                      <p className="text-sm font-semibold text-foreground">{ret.pantone}</p>
                    </div>

                    <div className="min-w-20">
                      <p className="text-[10px] uppercase text-muted-foreground">Kg recibidos</p>
                      <p className="text-base font-bold font-mono text-emerald-700 dark:text-emerald-400">{ret.kg_disponibles}</p>
                    </div>

                    <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-300 dark:bg-emerald-900/30 dark:text-emerald-400 dark:border-emerald-700">
                      Confirmada
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
