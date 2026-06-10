"use client"

import { useState, useMemo, useEffect } from "react"
import Link from "next/link"
import { useParams, useSearchParams, useRouter } from "next/navigation"
import { useInkStore } from "@/lib/store"
import { useTableroHub } from "@/lib/tablero-hub"
import { machineIdToPrensa, normalizePrensaCode, parseCantidadPorUnidad } from "@/lib/tablero-mappers"
import type { CuerpoImpresor } from "@/lib/mock-data"
import { calcularTiempoMinutos, determinarUrgencia } from "@/lib/mock-data"
import { getPrintCard, getTinta, calcularKgPorColor, getKgBaseMaquina, type KgPorColor } from "@/lib/pocketbase"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { UrgencyBadge } from "@/components/urgency-badge"
import { ArrowLeft, Calculator, Send, Loader2 } from "lucide-react"
import { toast } from "sonner"

// Kg base por máquina (del Excel)
const KG_BASE_MAQUINA: Record<string, number> = {
  "I01-BOBST 1": 20, "I02-BOBST 2": 20, "I03-VISION 4": 10,
  "I04-VISION 3": 10, "I05-VISION 2": 10, "I06-BOBST 3": 20,
  "I07-VISION 1": 10, "I08-SCHIAVI": 20,
}

export default function SolicitudPage() {
  const params = useParams()
  const searchParams = useSearchParams()
  const router = useRouter()
  const id = params.id as string
  const cuerpoParam = searchParams.get("cuerpo")
  const cuerpoNum = cuerpoParam ? parseInt(cuerpoParam) : 1

  const normalizedMachineId = /^\d{1,2}$/.test(id) ? `bobst-${id.padStart(2, "0")}` : id
  const prensa = machineIdToPrensa(normalizedMachineId) ?? machineIdToPrensa(id)
  const { datos: datosTablero } = useTableroHub(prensa ?? undefined)
  const { crearSolicitud } = useInkStore()
  const tableroActual = datosTablero.find((row) => normalizePrensaCode(row.prensa) === prensa) ?? null
  const impresora = {
    id: normalizedMachineId,
    nombre: tableroActual ? `Prensa ${tableroActual.prensa}` : `Prensa ${prensa ?? id}`,
    trabajoActual: tableroActual
      ? {
          metrosRestantes: parseCantidadPorUnidad(tableroActual.cantidadFaltante, "MTR") ?? 0,
          velocidadActual: 0,
          anchoImpresion: 1,
        }
      : null,
    cuerpos: [] as CuerpoImpresor[],
  }

  const [printCard, setPrintCard] = useState("")
  const [metrosRestantes, setMetrosRestantes] = useState(
    impresora.trabajoActual?.metrosRestantes || 0
  )
  const [velocidadActual, setVelocidadActual] = useState(
    impresora.trabajoActual?.velocidadActual || 0
  )
  const [kgEnMaquina, setKgEnMaquina] = useState(
    0
  )

  const [loadingPC, setLoadingPC] = useState(false)
  const [coloresData, setColoresData] = useState<KgPorColor[]>([])
  const [anchoCm, setAnchoCm] = useState(impresora.trabajoActual?.anchoImpresion ? impresora.trabajoActual.anchoImpresion * 100 : 100)
  const [maquinaNombre, setMaquinaNombre] = useState("")
  const [kgBaseMaquina, setKgBaseMaquina] = useState(0)
  const [pcError, setPcError] = useState("")

  if (!tableroActual) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-muted-foreground">No hay datos de esta prensa en el hub</p>
      </div>
    )
  }

  const cuerpo = impresora.cuerpos.find((c) => c.numero === cuerpoNum)

  async function buscarPrintCard() {
    if (!printCard.trim()) return
    setLoadingPC(true)
    setPcError("")
    setColoresData([])

    const pc = await getPrintCard(printCard.trim())
    if (!pc) {
      setPcError("Print Card no encontrado en la base de datos")
      setLoadingPC(false)
      return
    }

    setAnchoCm(pc.ancho)
    setMaquinaNombre(pc.maquina)
    const kgBase = await getKgBaseMaquina(pc.maquina) ?? KG_BASE_MAQUINA[pc.maquina] ?? 0
    setKgBaseMaquina(kgBase)

    // Para cada color, buscar sus datos de tinta
    const resultados: KgPorColor[] = []
    for (let i = 0; i < pc.colores.length; i++) {
      const colorNombre = pc.colores[i]
      const cobertura = pc.coberturas[i]
      if (!colorNombre || cobertura === 0) continue

      const tinta = await getTinta(colorNombre)
      if (!tinta) {
        resultados.push({
          color: colorNombre,
          tinta: colorNombre,
          bcm: 0,
          densidad: 0,
          cobertura,
          kgConsumo: 0,
          kgBase: 0,
          kgBruto: 0,
          kgTinta: 0,
          kgDisolvente: 0,
          anilox: 0,
        })
        continue
      }

      const { kgConsumo, kgBase: kgBaseCalculado, kgBruto, kgTinta, kgDisolvente } = calcularKgPorColor(
        metrosRestantes,
        pc.ancho,
        tinta.bcm,
        tinta.densidad,
        cobertura,
        kgBase
      )

      resultados.push({
        color: colorNombre,
        tinta: tinta.tinta,
        bcm: tinta.bcm,
        densidad: tinta.densidad,
        cobertura,
        kgConsumo,
        kgBase: kgBaseCalculado,
        kgBruto,
        kgTinta,
        kgDisolvente,
        anilox: tinta.anilox,
      })
    }

    setColoresData(resultados)
    setLoadingPC(false)
  }

  // Recalcular cuando cambian los metros
  useEffect(() => {
    if (coloresData.length === 0 || anchoCm === 0) return
    const kgBase = kgBaseMaquina || KG_BASE_MAQUINA[maquinaNombre] || 0
    const nuevos = coloresData.map(c => {
      if (c.bcm === 0) return c
      const { kgConsumo, kgBase: kgBaseCalculado, kgBruto, kgTinta, kgDisolvente } = calcularKgPorColor(
        metrosRestantes, anchoCm, c.bcm, c.densidad, c.cobertura, kgBase
      )
      return { ...c, kgConsumo, kgBase: kgBaseCalculado, kgBruto, kgTinta, kgDisolvente }
    })
    setColoresData(nuevos)
  }, [metrosRestantes, anchoCm, kgBaseMaquina, maquinaNombre])

  const totalKg = coloresData.reduce((s, c) => s + c.kgTinta, 0)
  const tiempoMin = calcularTiempoMinutos(metrosRestantes, velocidadActual)
  const urgencia = determinarUrgencia(tiempoMin)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (coloresData.length === 0) {
      toast.error("Busca un Print Card primero")
      return
    }

    crearSolicitud({
      impresoraId: impresora.id,
      impresoraNombre: impresora.nombre,
      cuerpoNumero: cuerpoNum,
      color: coloresData.map(c => c.color).join(", "),
      serieTinta: cuerpo?.serieTinta ?? "N/D",
      kgEnMaquina,
      metrosRestantes,
      superficiePorcentaje: coloresData[0]?.cobertura * 100 || 0,
      aniloxLineatura: coloresData[0]?.anilox || 0,
      aniloxVolumen: coloresData[0]?.bcm || 0,
      velocidadActual,
      viscosidadActual: 22,
      anchoImpresion: anchoCm / 100,
      kgAFabricar: Math.round(totalKg * 10) / 10,
      tiempoEstimadoMin: tiempoMin,
      urgencia,
    })

    toast.success("Solicitud enviada a cocina de tintas", {
      description: `${Math.round(totalKg * 10) / 10} kg totales para ${impresora.nombre}`,
    })
    router.push(`/maquina/${id}`)
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href={`/maquina/${id}`}>
          <Button variant="ghost" size="icon" className="shrink-0">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h2 className="text-2xl font-bold text-foreground">Solicitar Tinta</h2>
          <p className="text-sm text-muted-foreground">
            {impresora.nombre} - Cuerpo {cuerpoNum}
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="grid gap-6 lg:grid-cols-3">
        {/* Left */}
        <div className="flex flex-col gap-4 lg:col-span-2">

          {/* Print Card lookup */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base text-foreground">Print Card</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex gap-2">
                <Input
                  placeholder="Ej: E-10003-A_R-16"
                  value={printCard}
                  onChange={e => setPrintCard(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && (e.preventDefault(), buscarPrintCard())}
                  className="font-mono"
                />
                <Button type="button" onClick={buscarPrintCard} disabled={loadingPC}>
                  {loadingPC ? <Loader2 className="h-4 w-4 animate-spin" /> : "Buscar"}
                </Button>
              </div>
              {pcError && <p className="mt-2 text-sm text-destructive">{pcError}</p>}
              {maquinaNombre && (
                <p className="mt-2 text-sm text-muted-foreground">
                  Máquina: <span className="font-medium text-foreground">{maquinaNombre}</span>
                  {" · "}Ancho: <span className="font-medium text-foreground">{anchoCm} cm</span>
                </p>
              )}
            </CardContent>
          </Card>

          {/* Datos de producción */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base text-foreground">Datos de Producción</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="flex flex-col gap-2">
                  <Label>Metros Restantes</Label>
                  <Input
                    type="number"
                    value={metrosRestantes}
                    onChange={e => setMetrosRestantes(parseFloat(e.target.value) || 0)}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label>Velocidad (m/min)</Label>
                  <Input
                    type="number"
                    value={velocidadActual}
                    onChange={e => setVelocidadActual(parseFloat(e.target.value) || 0)}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label>Kg en Máquina</Label>
                  <Input
                    type="number"
                    step="0.1"
                    value={kgEnMaquina}
                    onChange={e => setKgEnMaquina(parseFloat(e.target.value) || 0)}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Tabla de colores calculados */}
          {coloresData.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base text-foreground">Kg por Color</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-muted-foreground">
                        <th className="pb-2 text-left font-medium">Color</th>
                        <th className="pb-2 text-left font-medium">Tinta</th>
                        <th className="pb-2 text-right font-medium">Cob. %</th>
                        <th className="pb-2 text-right font-medium">Anilox</th>
                        <th className="pb-2 text-right font-medium">BCM</th>
                        <th className="pb-2 text-right font-medium font-mono">Kg Tinta</th>
                        <th className="pb-2 text-right font-medium font-mono">Kg Disol.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {coloresData.map((c, i) => (
                        <tr key={i} className="border-b last:border-0">
                          <td className="py-2 font-medium">{c.color}</td>
                          <td className="py-2 text-muted-foreground">{c.tinta}</td>
                          <td className="py-2 text-right">{(c.cobertura * 100).toFixed(1)}%</td>
                          <td className="py-2 text-right">{c.anilox || "ND"}</td>
                          <td className="py-2 text-right">{c.bcm || "ND"}</td>
                          <td className="py-2 text-right">
                            {c.kgTinta > 0 ? (
                              <div className="flex flex-col items-end">
                                <span className="font-mono font-bold text-foreground">{c.kgTinta} kg</span>
                                <span className="text-[10px] text-muted-foreground">
                                  consumo {c.kgConsumo} + base {c.kgBase}
                                </span>
                              </div>
                            ) : "-"}
                          </td>
                          <td className="py-2 text-right font-mono text-muted-foreground">
                            {c.kgDisolvente > 0 ? `${c.kgDisolvente} kg` : "-"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2">
                        <td colSpan={5} className="pt-2 font-bold">TOTAL</td>
                        <td className="pt-2 text-right font-mono font-bold text-foreground text-base">
                          {Math.round(totalKg * 10) / 10} kg
                        </td>
                        <td className="pt-2 text-right font-mono text-muted-foreground">
                          {Math.round(coloresData.reduce((s, c) => s + c.kgDisolvente, 0) * 10) / 10} kg
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right: Resumen */}
        <div className="flex flex-col gap-4">
          <Card className="border-2 border-primary/20 bg-accent/30">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base text-foreground">
                <Calculator className="h-4 w-4" />
                Resumen
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="rounded-lg bg-card p-4">
                <p className="text-xs font-medium uppercase text-muted-foreground">
                  Kg Totales a Fabricar
                </p>
                <p className="text-3xl font-bold font-mono text-foreground">
                  {coloresData.length > 0 ? Math.round(totalKg * 10) / 10 : "--"}
                </p>
                <p className="text-xs text-muted-foreground">kilogramos</p>
              </div>

              <div className="rounded-lg bg-card p-4">
                <p className="text-xs font-medium uppercase text-muted-foreground">
                  Tiempo Estimado
                </p>
                <p className="text-3xl font-bold font-mono text-foreground">
                  {tiempoMin === 999 ? "--" : tiempoMin}
                </p>
                <p className="text-xs text-muted-foreground">minutos hasta agotamiento</p>
              </div>

              <div className="rounded-lg bg-card p-4">
                <p className="mb-2 text-xs font-medium uppercase text-muted-foreground">
                  Nivel de Urgencia
                </p>
                <UrgencyBadge
                  urgencia={urgencia}
                  tiempoMin={tiempoMin === 999 ? undefined : tiempoMin}
                  pulsing
                />
              </div>
            </CardContent>
          </Card>

          <Button type="submit" size="lg" className="w-full" disabled={coloresData.length === 0}>
            <Send className="mr-2 h-4 w-4" />
            Enviar Solicitud a Cocina
          </Button>
        </div>
      </form>
    </div>
  )
}
