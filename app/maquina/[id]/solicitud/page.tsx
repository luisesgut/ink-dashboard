"use client"

import { useState, useMemo, useEffect } from "react"
import Link from "next/link"
import { useParams, useSearchParams } from "next/navigation"
import { useInkStore } from "@/lib/store"
import { useTableroHub } from "@/lib/tablero-hub"
import { machineIdToPrensa, normalizePrensaCode, parseCantidadPorUnidad } from "@/lib/tablero-mappers"
import type { CuerpoImpresor } from "@/lib/mock-data"
import {
  calcularKgPorColor,
  getPrintCard,
  getPrintCardHibrido,
  getKgBaseMaquina,
  type KgPorColor,
} from "@/lib/pocketbase"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ArrowLeft, Calculator, Loader2, Send } from "lucide-react"
import { toast } from "sonner"

const MAQUINA_PRUEBA_ID = "prueba-manual"
const KG_BASE_MANUAL = 0

interface FilaColorManual extends KgPorColor {
  kgEnMaquina: string
  viscosidad: string
  calculado: boolean
  enviando: boolean
}

function roundKg(value: number): number {
  return Math.round(value * 10) / 10
}

function crearFilaManual(color: KgPorColor): FilaColorManual {
  return {
    ...color,
    kgConsumo: 0,
    kgBruto: 0,
    kgTinta: 0,
    kgDisolvente: 0,
    kgEnMaquina: "",
    viscosidad: "",
    calculado: false,
    enviando: false,
  }
}

export default function SolicitudPage() {
  const params = useParams()
  const searchParams = useSearchParams()
  const id = params.id as string
  const cuerpoParam = searchParams.get("cuerpo")
  const cuerpoNum = cuerpoParam ? parseInt(cuerpoParam) : 1
  const esPruebaManual = id === MAQUINA_PRUEBA_ID

  const normalizedMachineId = /^\d{1,2}$/.test(id) ? `bobst-${id.padStart(2, "0")}` : id
  const prensa = machineIdToPrensa(normalizedMachineId) ?? machineIdToPrensa(id)
  const { datos: datosTablero } = useTableroHub(prensa ?? undefined)
  const { crearSolicitud } = useInkStore()
  const tableroActual = datosTablero.find((row) => normalizePrensaCode(row.prensa) === prensa) ?? null
  const impresora = {
    id: normalizedMachineId,
    nombre: esPruebaManual
      ? "Maquina de prueba manual"
      : tableroActual
        ? `Prensa ${tableroActual.prensa}`
        : `Prensa ${prensa ?? id}`,
    trabajoActual: tableroActual
      ? {
          metrosRestantes: parseCantidadPorUnidad(tableroActual.cantidadFaltante, "MTR") ?? 0,
          velocidadActual: 0,
          anchoImpresion: 1,
        }
      : null,
    cuerpos: [] as CuerpoImpresor[],
  }

  const cuerpo = impresora.cuerpos.find((c) => c.numero === cuerpoNum)
  const [printCard, setPrintCard] = useState("")
  const [metrosRestantes, setMetrosRestantes] = useState(
    impresora.trabajoActual?.metrosRestantes || 0
  )
  const [velocidadActual, setVelocidadActual] = useState(
    impresora.trabajoActual?.velocidadActual || 0
  )
  const [anchoCm, setAnchoCm] = useState(
    impresora.trabajoActual?.anchoImpresion
      ? impresora.trabajoActual.anchoImpresion * 100
      : 100
  )
  const [kgBaseMaquina, setKgBaseMaquina] = useState(KG_BASE_MANUAL)
  const [kgBaseEnMaquina, setKgBaseEnMaquina] = useState(false)
  const [coloresData, setColoresData] = useState<FilaColorManual[]>([])
  const [loadingPC, setLoadingPC] = useState(false)
  const [pcError, setPcError] = useState("")
  const [maquinaNombre, setMaquinaNombre] = useState("")

  const totalKg = useMemo(
    () => roundKg(coloresData.reduce((sum, color) => sum + color.kgTinta, 0)),
    [coloresData]
  )
  const filasCalculadas = useMemo(() => coloresData.filter((color) => color.calculado), [coloresData])

  useEffect(() => {
    setMetrosRestantes(impresora.trabajoActual?.metrosRestantes || 0)
    setVelocidadActual(impresora.trabajoActual?.velocidadActual || 0)
  }, [impresora.trabajoActual?.metrosRestantes, impresora.trabajoActual?.velocidadActual])

  async function buscarPrintCard() {
    const codigo = printCard.trim()
    if (!codigo) {
      toast.error("Ingresa un Print Card")
      return
    }
    if (!(metrosRestantes > 0)) {
      toast.error("Ingresa los metros a imprimir")
      return
    }
    if (!(anchoCm > 0)) {
      toast.error("Ingresa el ancho de impresion en cm")
      return
    }

    setLoadingPC(true)
    setPcError("")
    setColoresData([])

    try {
      const pc = await getPrintCard(codigo)
      let anchoParaCalculo = anchoCm
      let kgBase = kgBaseMaquina

      if (pc) {
        if (pc.ancho > 0) {
          anchoParaCalculo = pc.ancho
          setAnchoCm(pc.ancho)
        }
        setMaquinaNombre(pc.maquina)
        kgBase = pc.maquina ? await getKgBaseMaquina(pc.maquina) ?? kgBaseMaquina : kgBaseMaquina
        setKgBaseMaquina(kgBase)
      } else {
        setMaquinaNombre(esPruebaManual ? "Captura manual" : "")
      }

      const resultados = await getPrintCardHibrido(codigo, metrosRestantes, anchoParaCalculo, kgBase)
      if (!resultados.length) {
        setPcError("No se encontraron tintas para ese Print Card")
        return
      }

      setColoresData(resultados.map(crearFilaManual))
    } finally {
      setLoadingPC(false)
    }
  }

  function actualizarFila(index: number, campo: "kgEnMaquina" | "viscosidad", valor: string) {
    setColoresData(prev => prev.map((fila, i) => (
      i === index ? { ...fila, [campo]: valor, calculado: false } : fila
    )))
  }

  function invalidarCalculos() {
    setColoresData(prev => prev.map((fila) => ({ ...fila, calculado: false })))
  }

  function calcularFilas() {
    if (!coloresData.length) {
      toast.error("Busca un Print Card primero")
      return
    }
    if (!(metrosRestantes > 0)) {
      toast.error("Ingresa los metros a imprimir")
      return
    }
    if (!(anchoCm > 0)) {
      toast.error("Ingresa el ancho de impresion en cm")
      return
    }

    setColoresData(prev => prev.map((fila) => {
      const kgEnMaquinaCapturado = parseFloat(fila.kgEnMaquina) || 0
      const kgEnMaquinaFila = kgBaseEnMaquina
        ? Math.max(kgEnMaquinaCapturado, kgBaseMaquina)
        : kgEnMaquinaCapturado
      const { kgConsumo, kgBase: kgBaseCalculado, kgBruto, kgTinta, kgDisolvente } = calcularKgPorColor(
        metrosRestantes,
        anchoCm,
        fila.bcm,
        fila.densidad,
        fila.cobertura,
        kgBaseMaquina,
        kgEnMaquinaFila
      )

      return {
        ...fila,
        kgEnMaquina: kgBaseEnMaquina ? String(roundKg(kgEnMaquinaFila)) : fila.kgEnMaquina,
        kgConsumo,
        kgBase: kgBaseCalculado,
        kgBruto,
        kgTinta,
        kgDisolvente,
        calculado: true,
      }
    }))
    toast.success("Calculo actualizado por Pantone")
  }

  if (!tableroActual && !esPruebaManual) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-muted-foreground">No hay datos de esta prensa en el hub</p>
      </div>
    )
  }

  async function enviarColor(index: number) {
    const color = coloresData[index]
    if (!color) return
    if (!color.calculado) {
      toast.error("Calcula la fila antes de enviar")
      return
    }
    if (!(color.kgTinta > 0)) {
      toast.error("No hay kg de tinta calculados para este Pantone")
      return
    }
    if (!(parseFloat(color.viscosidad) > 0)) {
      toast.error("Ingresa la viscosidad para este Pantone")
      return
    }
    if (!printCard.trim()) {
      toast.error("Busca un Print Card primero")
      return
    }

    setColoresData(prev => prev.map((fila, i) => i === index ? { ...fila, enviando: true } : fila))
    await crearSolicitud({
      impresoraId: impresora.id,
      impresoraNombre: impresora.nombre,
      ordenProduccion: esPruebaManual ? "PRUEBA-MANUAL" : undefined,
      printCard: printCard.trim(),
      metrosCalculo: metrosRestantes,
      runKey: esPruebaManual ? `manual-${printCard.trim()}-${color.color}-${Date.now()}` : undefined,
      cuerpoNumero: cuerpoNum,
      color: color.color,
      serieTinta: color.tinta || cuerpo?.serieTinta || "N/D",
      kgEnMaquina: parseFloat(color.kgEnMaquina) || 0,
      metrosRestantes,
      superficiePorcentaje: color.cobertura * 100,
      aniloxLineatura: color.anilox,
      aniloxVolumen: color.bcm,
      velocidadActual,
      viscosidadActual: parseFloat(color.viscosidad) || 0,
      anchoImpresion: anchoCm / 100,
      kgAFabricar: color.kgTinta,
      tiempoEstimadoMin: 999,
      urgencia: "verde",
    })

    setColoresData(prev => prev.map((fila, i) => i === index ? { ...fila, enviando: false } : fila))
    toast.success("Solicitud enviada a cocina de tintas", {
      description: `${color.kgTinta} kg de ${color.color}`,
    })
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href={esPruebaManual ? "/" : `/maquina/${id}`}>
          <Button variant="ghost" size="icon" className="shrink-0">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h2 className="text-2xl font-bold text-foreground">
            {esPruebaManual ? "Prueba Manual por Print Card" : "Solicitar Tinta"}
          </h2>
          <p className="text-sm text-muted-foreground">
            {impresora.nombre}{!esPruebaManual ? ` - Cuerpo ${cuerpoNum}` : ""}
          </p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base text-foreground">Print Card</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex gap-2">
                <Input
                  placeholder="Ej: E-10003-A_R-16"
                  value={printCard}
                  onChange={(e) => setPrintCard(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), buscarPrintCard())}
                  className="font-mono"
                />
                <Button type="button" onClick={buscarPrintCard} disabled={loadingPC}>
                  {loadingPC ? <Loader2 className="h-4 w-4 animate-spin" /> : "Buscar"}
                </Button>
              </div>
              {pcError && <p className="mt-2 text-sm text-destructive">{pcError}</p>}
              {(maquinaNombre || coloresData.length > 0) && (
                <p className="mt-2 text-sm text-muted-foreground">
                  Fuente: <span className="font-medium text-foreground">{maquinaNombre || "PrintCardTintas"}</span>
                  {" · "}Ancho: <span className="font-medium text-foreground">{anchoCm} cm</span>
                  {" · "}Kg base: <span className="font-medium text-foreground">{kgBaseMaquina} kg</span>
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base text-foreground">Datos Generales</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="metrosRestantes">Metros a imprimir</Label>
                  <Input
                    id="metrosRestantes"
                    type="number"
                    value={metrosRestantes}
                    onChange={(e) => {
                      setMetrosRestantes(parseFloat(e.target.value) || 0)
                      invalidarCalculos()
                    }}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="anchoCm">Ancho impresion (cm)</Label>
                  <Input
                    id="anchoCm"
                    type="number"
                    step="0.1"
                    value={anchoCm}
                    onChange={(e) => {
                      setAnchoCm(parseFloat(e.target.value) || 0)
                      invalidarCalculos()
                    }}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="velocidadActual">Velocidad (m/min)</Label>
                  <Input
                    id="velocidadActual"
                    type="number"
                    value={velocidadActual}
                    onChange={(e) => {
                      setVelocidadActual(parseFloat(e.target.value) || 0)
                      invalidarCalculos()
                    }}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="kgBaseMaquina">Kg base</Label>
                  <Input
                    id="kgBaseMaquina"
                    type="number"
                    step="0.1"
                    value={kgBaseMaquina}
                    onChange={(e) => {
                      setKgBaseMaquina(parseFloat(e.target.value) || 0)
                      invalidarCalculos()
                    }}
                  />
                </div>
                <div className="flex flex-col gap-2 sm:col-span-2">
                  <Label>Base de maquina</Label>
                  <label className="flex min-h-10 items-center gap-3 rounded-md border border-border px-3 py-2 text-sm">
                    <Checkbox
                      checked={kgBaseEnMaquina}
                      onCheckedChange={(checked) => {
                        setKgBaseEnMaquina(checked === true)
                        invalidarCalculos()
                      }}
                    />
                    <span>
                      Los kg base ya estan en maquina
                    </span>
                  </label>
                  <p className="text-xs text-muted-foreground">
                    Si no esta marcado, el kg base se suma a cada solicitud.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <Card className="border-2 border-primary/20 bg-accent/30">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base text-foreground">
                <Calculator className="h-4 w-4" />
                Calculo Automatico
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="rounded-lg bg-card p-4">
                <p className="text-xs font-medium uppercase text-muted-foreground">
                  Kg a Fabricar
                </p>
                <p className="text-3xl font-bold font-mono text-foreground">
                  {filasCalculadas.length > 0 ? totalKg : "--"}
                </p>
                <p className="text-xs text-muted-foreground">kilogramos</p>
              </div>
            </CardContent>
          </Card>

          <Button type="button" size="lg" className="w-full" disabled={coloresData.length === 0 || loadingPC} onClick={calcularFilas}>
            <Calculator className="mr-2 h-4 w-4" />
            Calcular
          </Button>
        </div>

        {coloresData.length > 0 && (
          <Card className="lg:col-span-3">
            <CardHeader>
              <CardTitle className="text-base text-foreground">Tintas del Print Card</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="min-w-[980px] w-full text-sm">
                  <thead>
                    <tr className="border-b text-muted-foreground">
                      <th className="w-40 pb-2 text-left font-medium">Color</th>
                      <th className="w-44 pb-2 text-left font-medium">Tinta</th>
                      <th className="w-20 pb-2 text-right font-medium">Cob. %</th>
                      <th className="w-20 pb-2 text-right font-medium">Anilox</th>
                      <th className="w-20 pb-2 text-right font-medium">BCM</th>
                      <th className="w-28 pb-2 text-right font-medium">Kg maq.</th>
                      <th className="w-24 pb-2 text-right font-medium">Visc.</th>
                      <th className="w-28 pb-2 text-right font-medium font-mono">Kg tinta</th>
                      <th className="w-28 pb-2 text-right font-medium">Accion</th>
                    </tr>
                  </thead>
                  <tbody>
                    {coloresData.map((color, index) => (
                      <tr key={`${color.color}-${index}`} className="border-b last:border-0">
                        <td className="py-2 pr-3 font-medium">{color.color}</td>
                        <td className="py-2 pr-3 text-muted-foreground">{color.tinta}</td>
                        <td className="py-2 text-right">{(color.cobertura * 100).toFixed(1)}%</td>
                        <td className="py-2 text-right">{color.anilox || "ND"}</td>
                        <td className="py-2 text-right">{color.bcm || "ND"}</td>
                        <td className="py-2 text-right">
                          <Input
                            type="number"
                            step="0.1"
                            value={color.kgEnMaquina}
                            onChange={(e) => actualizarFila(index, "kgEnMaquina", e.target.value)}
                            className="ml-auto h-8 w-24 text-right font-mono text-xs"
                            placeholder="kg"
                          />
                        </td>
                        <td className="py-2 text-right">
                          <Input
                            type="number"
                            step="0.1"
                            value={color.viscosidad}
                            onChange={(e) => actualizarFila(index, "viscosidad", e.target.value)}
                            className="ml-auto h-8 w-20 text-right font-mono text-xs"
                            placeholder="seg"
                          />
                        </td>
                        <td className="py-2 text-right font-mono font-semibold">
                          {color.calculado ? `${color.kgTinta} kg` : "--"}
                        </td>
                        <td className="py-2 text-right">
                          <Button
                            type="button"
                            size="sm"
                            className="h-8"
                            onClick={() => enviarColor(index)}
                            disabled={color.enviando || !color.calculado || color.kgTinta <= 0}
                          >
                            {color.enviando ? <Loader2 className="h-3 w-3 animate-spin" /> : <><Send className="mr-1 h-3 w-3" />Enviar</>}
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2">
                      <td colSpan={7} className="pt-2 font-bold">TOTAL CALCULADO</td>
                      <td className="pt-2 text-right font-mono font-bold text-foreground text-base">{totalKg} kg</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
