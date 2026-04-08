"use client"

import { useState, useMemo } from "react"
import Link from "next/link"
import { useParams, useSearchParams, useRouter } from "next/navigation"
import { useInkStore } from "@/lib/store"
import { useTableroHub } from "@/lib/tablero-hub"
import { machineIdToPrensa, normalizePrensaCode, parseCantidadPorUnidad } from "@/lib/tablero-mappers"
import type { CuerpoImpresor } from "@/lib/mock-data"
import { calcularKgNecesarios, calcularTiempoMinutos, determinarUrgencia } from "@/lib/mock-data"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { UrgencyBadge } from "@/components/urgency-badge"
import { ArrowLeft, Calculator, Send } from "lucide-react"
import { toast } from "sonner"

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

  if (!tableroActual) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-muted-foreground">No hay datos de esta prensa en el hub</p>
      </div>
    )
  }

  const cuerpo = impresora.cuerpos.find((c) => c.numero === cuerpoNum)

  const [formData, setFormData] = useState({
    kgEnMaquina: cuerpo?.kgRestantes ?? 0,
    metrosRestantes: impresora.trabajoActual?.metrosRestantes || 0,
    color: cuerpo?.color ?? "",
    viscosidad: 22,
    superficiePorcentaje: cuerpo?.superficiePorcentaje ?? 0,
    aniloxLineatura: cuerpo?.anilox.lineatura ?? 0,
    aniloxVolumen: cuerpo?.anilox.volumen ?? 0,
    velocidadActual: impresora.trabajoActual?.velocidadActual || 0,
    anchoImpresion: impresora.trabajoActual?.anchoImpresion || 1.0,
  })

  const calculos = useMemo(() => {
    const kgAFabricar = calcularKgNecesarios(
      formData.metrosRestantes,
      formData.superficiePorcentaje,
      formData.aniloxVolumen,
      formData.anchoImpresion,
      formData.kgEnMaquina
    )
    const tiempoMin = calcularTiempoMinutos(
      formData.metrosRestantes,
      formData.velocidadActual
    )
    const urgencia = determinarUrgencia(tiempoMin)
    return { kgAFabricar, tiempoMin, urgencia }
  }, [formData])

  function handleChange(field: string, value: string) {
    setFormData((prev) => ({
      ...prev,
      [field]: field === "color" ? value : parseFloat(value) || 0,
    }))
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    crearSolicitud({
      impresoraId: impresora.id,
      impresoraNombre: impresora.nombre,
      cuerpoNumero: cuerpoNum,
      color: formData.color,
      serieTinta: cuerpo?.serieTinta ?? "N/D",
      kgEnMaquina: formData.kgEnMaquina,
      metrosRestantes: formData.metrosRestantes,
      superficiePorcentaje: formData.superficiePorcentaje,
      aniloxLineatura: formData.aniloxLineatura,
      aniloxVolumen: formData.aniloxVolumen,
      velocidadActual: formData.velocidadActual,
      viscosidadActual: formData.viscosidad,
      anchoImpresion: formData.anchoImpresion,
      kgAFabricar: calculos.kgAFabricar,
      tiempoEstimadoMin: calculos.tiempoMin,
      urgencia: calculos.urgencia,
    })

    toast.success("Solicitud enviada a cocina de tintas", {
      description: `${calculos.kgAFabricar} kg de ${formData.color} para ${impresora.nombre} - Cuerpo ${cuerpoNum}`,
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
          <h2 className="text-2xl font-bold text-foreground">
            Solicitar Tinta
          </h2>
          <p className="text-sm text-muted-foreground">
            {impresora.nombre} - Cuerpo {cuerpoNum}
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="grid gap-6 lg:grid-cols-3">
        {/* Left: Form inputs */}
        <div className="flex flex-col gap-4 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base text-foreground">Datos de la Maquina</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="color">Color</Label>
                  <Input
                    id="color"
                    value={formData.color}
                    onChange={(e) => handleChange("color", e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="kgEnMaquina">Kg en Maquina</Label>
                  <Input
                    id="kgEnMaquina"
                    type="number"
                    step="0.1"
                    value={formData.kgEnMaquina}
                    onChange={(e) => handleChange("kgEnMaquina", e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="metrosRestantes">Metros Restantes</Label>
                  <Input
                    id="metrosRestantes"
                    type="number"
                    value={formData.metrosRestantes}
                    onChange={(e) => handleChange("metrosRestantes", e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="velocidadActual">Velocidad Actual (m/min)</Label>
                  <Input
                    id="velocidadActual"
                    type="number"
                    value={formData.velocidadActual}
                    onChange={(e) => handleChange("velocidadActual", e.target.value)}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base text-foreground">Parametros de Impresion</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="viscosidad">Viscosidad Actual</Label>
                  <Input
                    id="viscosidad"
                    type="number"
                    value={formData.viscosidad}
                    onChange={(e) => handleChange("viscosidad", e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="superficiePorcentaje">Superficie Color (%)</Label>
                  <Input
                    id="superficiePorcentaje"
                    type="number"
                    value={formData.superficiePorcentaje}
                    onChange={(e) => handleChange("superficiePorcentaje", e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="aniloxLineatura">Anilox Lineatura (LPI)</Label>
                  <Input
                    id="aniloxLineatura"
                    type="number"
                    value={formData.aniloxLineatura}
                    onChange={(e) => handleChange("aniloxLineatura", e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="aniloxVolumen">Anilox Volumen (cm3/m2)</Label>
                  <Input
                    id="aniloxVolumen"
                    type="number"
                    step="0.1"
                    value={formData.aniloxVolumen}
                    onChange={(e) => handleChange("aniloxVolumen", e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="anchoImpresion">Ancho Impresion (m)</Label>
                  <Input
                    id="anchoImpresion"
                    type="number"
                    step="0.1"
                    value={formData.anchoImpresion}
                    onChange={(e) => handleChange("anchoImpresion", e.target.value)}
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right: Calculations panel */}
        <div className="flex flex-col gap-4">
          <Card className="border-2 border-primary/20 bg-accent/30">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base text-foreground">
                <Calculator className="h-4 w-4" />
                Calculo Automatico
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="rounded-lg bg-card p-4">
                <p className="text-xs font-medium uppercase text-muted-foreground">
                  Kg a Fabricar
                </p>
                <p className="text-3xl font-bold font-mono text-foreground">
                  {calculos.kgAFabricar}
                </p>
                <p className="text-xs text-muted-foreground">kilogramos</p>
              </div>

              <div className="rounded-lg bg-card p-4">
                <p className="text-xs font-medium uppercase text-muted-foreground">
                  Tiempo Estimado
                </p>
                <p className="text-3xl font-bold font-mono text-foreground">
                  {calculos.tiempoMin === 999 ? "--" : calculos.tiempoMin}
                </p>
                <p className="text-xs text-muted-foreground">
                  minutos hasta agotamiento
                </p>
              </div>

              <div className="rounded-lg bg-card p-4">
                <p className="mb-2 text-xs font-medium uppercase text-muted-foreground">
                  Nivel de Urgencia
                </p>
                <UrgencyBadge
                  urgencia={calculos.urgencia}
                  tiempoMin={calculos.tiempoMin === 999 ? undefined : calculos.tiempoMin}
                  pulsing
                />
              </div>
            </CardContent>
          </Card>

          <Button type="submit" size="lg" className="w-full">
            <Send className="mr-2 h-4 w-4" />
            Enviar Solicitud a Cocina
          </Button>
        </div>
      </form>
    </div>
  )
}
