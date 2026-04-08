"use client"

import { useEffect, useMemo, useState } from "react"
import { PrinterCard } from "@/components/printer-card"
import { Card, CardContent } from "@/components/ui/card"
import { useTableroHub } from "@/lib/tablero-hub"
import { mergeCatalogoConHub, tintasToImpresoras } from "@/lib/tablero-mappers"
import { getMaquinasCatalogo, type CatalogoMaquina } from "@/lib/pocketbase"
import { LoaderCircle, Printer } from "lucide-react"

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
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-foreground text-balance">
          Panel de Control
        </h2>
        <p className="text-sm text-muted-foreground">
          Estado en tiempo real de las impresoras y solicitudes de tinta
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Fuente: tableroImpresionHub ({connectionState})
          {error ? ` - ${error}` : ""}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Catalogo de maquinas: {catalogoMaquinas.length > 0 ? `${catalogoMaquinas.length} registradas` : "no disponible"}
          {catalogoError ? ` - ${catalogoError}` : ""}
        </p>
      </div>

      {/* Printer Grid */}
      <div>
        <h3 className="mb-4 text-lg font-semibold text-foreground">
          Impresoras
        </h3>
        {cargandoHub ? (
          <Card>
            <CardContent className="flex min-h-40 flex-col items-center justify-center gap-3 text-muted-foreground">
              <LoaderCircle className="h-10 w-10 animate-spin" />
              <p className="text-sm">Conectando al hub de órdenes...</p>
            </CardContent>
          </Card>
        ) : impresoras.length === 0 ? (
          <Card>
            <CardContent className="flex min-h-40 flex-col items-center justify-center gap-2 text-muted-foreground">
              <Printer className="h-10 w-10 opacity-40" />
              <p className="text-sm font-medium">Sin datos del hub</p>
              <p className="text-xs">No se recibieron máquinas desde `172.16.10.31`.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
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
    </div>
  )
}
