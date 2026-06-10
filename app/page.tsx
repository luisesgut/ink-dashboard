"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { PrinterCard } from "@/components/printer-card"
import { Card, CardContent } from "@/components/ui/card"
import { useTableroHub } from "@/lib/tablero-hub"
import { mergeCatalogoConHub, tintasToImpresoras } from "@/lib/tablero-mappers"
import { getMaquinasCatalogo, type CatalogoMaquina } from "@/lib/pocketbase"
import { LoaderCircle, Printer, Wifi, WifiOff, Activity, FlaskConical } from "lucide-react"
import { cn } from "@/lib/utils"

function StatPill({
  count,
  label,
  dotClass,
}: {
  count: number
  label: string
  dotClass: string
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2">
      <span className={cn("h-2 w-2 rounded-full flex-shrink-0", dotClass)} />
      <span className="text-lg font-bold text-foreground tabular-nums">{count}</span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  )
}

function ConnectionDot({ state }: { state: string }) {
  const isConnected = state === "Connected"
  const isConnecting = state === "Connecting" || state === "Reconnecting"
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium border",
        isConnected && "bg-emerald-500/10 text-emerald-600 border-emerald-200 dark:text-emerald-400 dark:border-emerald-800",
        isConnecting && "bg-amber-500/10 text-amber-600 border-amber-200 dark:text-amber-400 dark:border-amber-800",
        !isConnected && !isConnecting && "bg-red-500/10 text-red-600 border-red-200 dark:text-red-400 dark:border-red-800",
      )}
    >
      {isConnected ? (
        <Wifi className="h-3 w-3" />
      ) : (
        <WifiOff className="h-3 w-3" />
      )}
      {isConnecting ? "Conectando…" : isConnected ? "En vivo" : state}
    </span>
  )
}

export default function DashboardPage() {
  const { datos: datosTablero, connectionState, hasSynced, error } = useTableroHub()

  const [catalogoMaquinas, setCatalogoMaquinas] = useState<CatalogoMaquina[]>([])
  const [catalogoError, setCatalogoError] = useState<string | null>(null)

  const impresorasHub = useMemo(() => tintasToImpresoras(datosTablero), [datosTablero])
  const impresoras = useMemo(
    () =>
      catalogoMaquinas.length > 0
        ? mergeCatalogoConHub(catalogoMaquinas, datosTablero)
        : impresorasHub,
    [catalogoMaquinas, datosTablero, impresorasHub]
  )
  const cargandoHub = !hasSynced && connectionState !== "Disconnected"

  const [printCardsConDatos, setPrintCardsConDatos] = useState<Set<string>>(new Set())

  // Stats
  const stats = useMemo(() => ({
    activas: impresoras.filter(m => m.estado === "activa").length,
    paradas: impresoras.filter(m => m.estado === "parada").length,
    cambio: impresoras.filter(m => m.estado === "cambio").length,
  }), [impresoras])

  useEffect(() => {
    let cancelled = false

    const cargarCatalogo = async () => {
      const maquinas = await getMaquinasCatalogo()
      if (cancelled) return

      if (maquinas.length > 0) {
        setCatalogoMaquinas(maquinas)
        setCatalogoError(null)
        return
      }

      setCatalogoError("No fue posible cargar el catalogo real de maquinas")
    }

    void cargarCatalogo()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!datosTablero.length) return
    const printCards = [...new Set(datosTablero.map(d => d.printCard).filter(Boolean))]

    Promise.all(
      printCards.map(async pc => {
        try {
          const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/PrintCardTintas/${encodeURIComponent(pc)}`)
          if (res.ok) {
            const data = await res.json()
            return data.length > 0 ? pc : null
          }
          return null
        } catch { return null }
      })
    ).then(results => {
      setPrintCardsConDatos(new Set(results.filter(Boolean) as string[]))
    })
  }, [datosTablero])

  return (
    <div className="flex flex-col gap-6">
      {/* Page header */}
      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-primary" />
            <h2 className="text-xl font-bold tracking-tight text-foreground">
              Panel de Control
            </h2>
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Estado en tiempo real de las impresoras
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <ConnectionDot state={connectionState} />
          {catalogoError && (
            <span className="text-[11px] text-amber-600 dark:text-amber-400">
              ⚠ Catálogo no disponible
            </span>
          )}
          {error && (
            <span className="text-[11px] text-red-600 dark:text-red-400 truncate max-w-xs">
              ⚠ {error}
            </span>
          )}
        </div>
      </div>

      {/* Beta warning */}
      <div className="rounded-lg border border-amber-300 bg-amber-500/10 px-4 py-3 flex items-start gap-3">
        <FlaskConical className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
        <div>
          <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">Sistema en fase de pruebas y calibración</p>
          <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
            Los cálculos de consumo son estimaciones. Revisa y verifica los resultados antes de solicitar materiales para evitar desperdicio innecesario.
          </p>
        </div>
      </div>

      {/* Stats row */}
      {!cargandoHub && impresoras.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <StatPill count={stats.activas} label="Activas" dotClass="bg-emerald-500" />
          <StatPill count={stats.paradas} label="Paradas" dotClass="bg-red-500" />
          <StatPill count={stats.cambio} label="En cambio" dotClass="bg-amber-500" />
          <div className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2 ml-auto">
            <Printer className="h-4 w-4 text-muted-foreground" />
            <span className="text-lg font-bold text-foreground tabular-nums">{impresoras.length}</span>
            <span className="text-xs text-muted-foreground">total</span>
          </div>
        </div>
      )}

      {/* Grid */}
      {cargandoHub ? (
        <Card>
          <CardContent className="flex min-h-48 flex-col items-center justify-center gap-3 text-muted-foreground">
            <LoaderCircle className="h-10 w-10 animate-spin text-primary/60" />
            <div className="text-center">
              <p className="text-sm font-medium">Conectando al hub de órdenes…</p>
              <p className="text-xs text-muted-foreground/70 mt-0.5">tableroImpresionHub</p>
            </div>
          </CardContent>
        </Card>
      ) : impresoras.length === 0 ? (
        <Card>
          <CardContent className="flex min-h-48 flex-col items-center justify-center gap-2 text-muted-foreground">
            <Printer className="h-10 w-10 opacity-30" />
            <p className="text-sm font-medium">Sin datos del hub</p>
            <p className="text-xs opacity-70">No se recibieron máquinas desde el servidor.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Link href="/maquina/prueba-manual/solicitud" className="block h-full outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-xl">
            <div className="group relative h-full min-h-[220px] rounded-xl border bg-card border-l-4 border-l-sky-500 transition-all duration-200 hover:shadow-md hover:shadow-black/5 dark:hover:shadow-black/20 hover:-translate-y-0.5 cursor-pointer">
              <div className="flex h-full flex-col gap-4 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="mt-0.5 h-2 w-2 flex-shrink-0 rounded-full bg-sky-500" />
                    <h3 className="text-sm font-bold text-foreground truncate leading-tight">
                      Maquina de prueba
                    </h3>
                  </div>
                  <span className="inline-flex items-center gap-1 rounded-md border border-sky-300 bg-sky-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-sky-700 dark:text-sky-300">
                    <FlaskConical className="h-2.5 w-2.5" />
                    Manual
                  </span>
                </div>

                <div className="flex flex-1 flex-col justify-center gap-3 text-muted-foreground">
                  <FlaskConical className="h-8 w-8 text-sky-500/70" />
                  <div>
                    <p className="text-xs font-semibold text-foreground">Prueba por Print Card</p>
                    <p className="mt-1 text-[11px] leading-snug">
                      Captura printcard, metros, ancho y kilos manuales; las tintas salen del endpoint real.
                    </p>
                  </div>
                </div>

                <div className="border-t border-border/60 pt-3">
                  <span className="text-[10px] font-semibold uppercase text-sky-700 dark:text-sky-300">
                    Crear solicitud de prueba
                  </span>
                </div>
              </div>
            </div>
          </Link>
          {impresoras.map((impresora) => {
            const row = datosTablero.find(d =>
              d.prensa.replace(/\D/g, "").padStart(2, "0") === impresora.id.replace(/\D/g, "").padStart(2, "0")
            )
            const pc = row?.printCard ?? ""
            const tieneDatos = printCardsConDatos.has(pc)
            return (
              <PrinterCard
                key={impresora.id}
                impresora={impresora}
                printCard={pc}
                tieneDatos={tieneDatos}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}
