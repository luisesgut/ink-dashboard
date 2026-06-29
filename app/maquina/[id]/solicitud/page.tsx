"use client"

import { useState, useMemo, useEffect } from "react"
import Link from "next/link"
import { useParams, useSearchParams } from "next/navigation"
import { useInkStore } from "@/lib/store"
import { useTableroHub } from "@/lib/tablero-hub"
import { machineIdToPrensa, normalizePrensaCode, parseCantidadPorUnidad } from "@/lib/tablero-mappers"
import { determinarUrgencia, type CuerpoImpresor, type SolicitudTinta } from "@/lib/mock-data"
import {
  calcularKgPorColor,
  calcularTiempoPorTinta,
  createPrintCard,
  createInkReturn,
  deleteInkReturn,
  getAniloxCatalogo,
  getInkReturns,
  getPrintCard,
  getPrintCardDesdePocketBase,
  getPrintCardsCatalogo,
  getPrintCardHibrido,
  getKgBaseMaquina,
  consolidarInkReturnsPorPantone,
  updateInkReturn,
  type AniloxCatalogo,
  type InkReturn,
  type KgPorColor,
  type PrintCardData,
} from "@/lib/pocketbase"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { FlashingAlert } from "@/components/flashing-alert"
import { StatusBadge } from "@/components/status-badge"
import { UrgencyBadge } from "@/components/urgency-badge"
import { cn } from "@/lib/utils"
import { Activity, ArrowLeft, Calculator, Check, ChevronDown, Loader2, Plus, Send, Trash2, Undo2 } from "lucide-react"
import { toast } from "sonner"

const MAQUINA_PRUEBA_ID = "prueba-manual"
const KG_BASE_MANUAL = 0
const MAQUINAS_PRUEBA_MANUAL = [
  {
    id: "vision-04",
    nombre: "VISION 04",
    kgBase: 10,
  },
]
const MAQUINA_PRUEBA_MANUAL_DEFAULT = MAQUINAS_PRUEBA_MANUAL[0]

interface FilaColorManual extends KgPorColor {
  kgEnMaquina: string
  viscosidad: string
  kgSolicitar: string
  tiempoMin: number
  calculado: boolean
  enviando: boolean
}

interface RecepcionDepositoManual {
  solicitud: SolicitudTinta
  kgDepositarInput: string
  destinoSobrante: "maquina" | "cocina"
  guardando: boolean
}

interface PrintCardPantoneInput {
  pantone: string
  cobertura: string
}

function roundKg(value: number): number {
  return Math.round(value * 10) / 10
}

function formatKg(value: number): string {
  return `${roundKg(value)} kg`
}

function getControlTintaEstado(kgCalculado: number, kgSolicitado: number) {
  const diferencia = roundKg(kgSolicitado - kgCalculado)
  if (!(kgCalculado > 0)) return { label: "Sin calculo", className: "border-border bg-muted text-muted-foreground", diferencia }
  if (!(kgSolicitado > 0)) return { label: "Faltante", className: "border-red-300 bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-400", diferencia }
  if (Math.abs(diferencia) <= 0.05) return { label: "Correcto", className: "border-emerald-300 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400", diferencia: 0 }
  if (diferencia > 0) return { label: "Exceso", className: "border-amber-300 bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-400", diferencia }
  return { label: "Faltante", className: "border-red-300 bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-400", diferencia }
}

function crearFilaManual(color: KgPorColor, retorno?: InkReturn): FilaColorManual {
  const kgDisponible = retorno?.confirmado === true ? retorno.kg_disponibles : 0
  return {
    ...color,
    kgConsumo: 0,
    kgBruto: 0,
    kgTinta: 0,
    kgDisolvente: 0,
    kgEnMaquina: kgDisponible > 0 ? String(kgDisponible) : "",
    viscosidad: "",
    kgSolicitar: "",
    tiempoMin: 999,
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
  const {
    crearSolicitud,
    confirmarDeposito,
    confirmarRecepcion,
    getNotificacionesPorMaquina,
    getSolicitudesPorMaquina,
  } = useInkStore()
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
  const [maquinaManualId, setMaquinaManualId] = useState(MAQUINA_PRUEBA_MANUAL_DEFAULT.id)
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
  const [loadingPrintCards, setLoadingPrintCards] = useState(false)
  const [printCardComboboxOpen, setPrintCardComboboxOpen] = useState(false)
  const [printCardsCatalogo, setPrintCardsCatalogo] = useState<PrintCardData[]>([])
  const [pcError, setPcError] = useState("")
  const [maquinaNombre, setMaquinaNombre] = useState("")
  const [aniloxCatalogo, setAniloxCatalogo] = useState<AniloxCatalogo[]>([])
  const [inkReturns, setInkReturns] = useState<Map<string, InkReturn>>(new Map())
  const [returnModal, setReturnModal] = useState<{
    color: string
    rowIndex: number
    existingId?: string
    existingKg: number
  } | null>(null)
  const [returnKgInput, setReturnKgInput] = useState("")
  const [returningInk, setReturningInk] = useState(false)
  const [recepcionDeposito, setRecepcionDeposito] = useState<RecepcionDepositoManual | null>(null)
  const [controlTintasOpen, setControlTintasOpen] = useState(true)
  const [crearPrintCardOpen, setCrearPrintCardOpen] = useState(false)
  const [printCardEditandoId, setPrintCardEditandoId] = useState<string | undefined>(undefined)
  const [creandoPrintCard, setCreandoPrintCard] = useState(false)
  const [nuevoPrintCardProducto, setNuevoPrintCardProducto] = useState("")
  const [nuevoPrintCardAncho, setNuevoPrintCardAncho] = useState("")
  const [nuevoPrintCardPantones, setNuevoPrintCardPantones] = useState<PrintCardPantoneInput[]>([
    { pantone: "", cobertura: "" },
  ])
  const maquinaManualSeleccionada = MAQUINAS_PRUEBA_MANUAL.find((m) => m.id === maquinaManualId) ?? MAQUINA_PRUEBA_MANUAL_DEFAULT
  const impresoraIdDestino = esPruebaManual ? maquinaManualSeleccionada.id : impresora.id
  const impresoraNombreDestino = esPruebaManual ? maquinaManualSeleccionada.nombre : impresora.nombre

  const totalKg = useMemo(
    () => roundKg(coloresData.reduce((sum, color) => sum + color.kgTinta, 0)),
    [coloresData]
  )
  const filasCalculadas = useMemo(() => coloresData.filter((color) => color.calculado), [coloresData])
  const solicitudesMaquina = getSolicitudesPorMaquina(impresoraIdDestino).filter(s => s.estado !== "depositado")
  const notificacionesMaquina = getNotificacionesPorMaquina(impresoraIdDestino).filter(n => !n.leida)
  const controlTintas = useMemo(() => {
    return coloresData.map((color) => {
      const kgCalculado = color.calculado ? color.kgTinta : 0
      const kgSolicitado = solicitudesMaquina
        .filter((s) => s.printCard === printCard.trim() && s.color === color.color)
        .reduce((sum, s) => sum + (s.kgAFabricar || 0), 0)
      const estado = getControlTintaEstado(kgCalculado, kgSolicitado)
      return {
        color: color.color,
        tinta: color.tinta,
        kgCalculado,
        kgSolicitado: roundKg(kgSolicitado),
        diferencia: estado.diferencia,
        estado,
      }
    })
  }, [coloresData, solicitudesMaquina, printCard])

  function calcularAutonomiaMinutos(fila: FilaColorManual, kgEnMaquina: number): number {
    return calcularTiempoPorTinta(
      kgEnMaquina,
      velocidadActual,
      anchoCm,
      fila.bcm,
      fila.densidad,
      fila.cobertura,
      kgBaseMaquina
    )
  }

  useEffect(() => {
    setMetrosRestantes(impresora.trabajoActual?.metrosRestantes || 0)
    setVelocidadActual(impresora.trabajoActual?.velocidadActual || 0)
  }, [impresora.trabajoActual?.metrosRestantes, impresora.trabajoActual?.velocidadActual])

  useEffect(() => {
    if (!esPruebaManual) return
    setKgBaseMaquina(maquinaManualSeleccionada.kgBase)
    invalidarCalculos()
  }, [esPruebaManual, maquinaManualSeleccionada.kgBase])

  useEffect(() => {
    getAniloxCatalogo().then(setAniloxCatalogo)
  }, [])

  useEffect(() => {
    let disposed = false

    setLoadingPrintCards(true)
    getPrintCardsCatalogo()
      .then((rows) => {
        if (!disposed) setPrintCardsCatalogo(rows)
      })
      .finally(() => {
        if (!disposed) setLoadingPrintCards(false)
      })

    return () => {
      disposed = true
    }
  }, [])

  useEffect(() => {
    let disposed = false

    const refreshInkReturns = async () => {
      const rows = await getInkReturns(impresoraIdDestino)
      if (!disposed) setInkReturns(consolidarInkReturnsPorPantone(rows))
    }

    void refreshInkReturns()
    const interval = window.setInterval(() => void refreshInkReturns(), 5000)
    return () => {
      disposed = true
      window.clearInterval(interval)
    }
  }, [impresoraIdDestino])

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
      const [pc, returnsList] = await Promise.all([
        getPrintCard(codigo),
        getInkReturns(impresoraIdDestino),
      ])
      const returnsMap = consolidarInkReturnsPorPantone(returnsList)
      setInkReturns(returnsMap)
      let anchoParaCalculo = anchoCm
      let kgBase = esPruebaManual ? maquinaManualSeleccionada.kgBase : kgBaseMaquina

      if (esPruebaManual && !pc) {
        setPcError("Print Card no encontrado en PocketBase")
        setPrintCardEditandoId(undefined)
        setNuevoPrintCardProducto("")
        setNuevoPrintCardAncho(anchoCm > 0 ? String(anchoCm) : "")
        setNuevoPrintCardPantones([{ pantone: "", cobertura: "" }])
        setCrearPrintCardOpen(true)
        return
      }

      if (pc) {
        if (pc.ancho > 0) {
          anchoParaCalculo = pc.ancho
          setAnchoCm(pc.ancho)
        }
        setMaquinaNombre(esPruebaManual ? "PocketBase print_cards" : pc.maquina)
        kgBase = esPruebaManual
          ? maquinaManualSeleccionada.kgBase
          : pc.maquina ? await getKgBaseMaquina(pc.maquina) ?? kgBaseMaquina : kgBaseMaquina
        setKgBaseMaquina(kgBase)
      } else {
        setMaquinaNombre(esPruebaManual ? "Captura manual" : "")
      }

      if (esPruebaManual && pc && pc.colores.length === 0) {
        setPcError("Print Card encontrado sin Pantones. Completa los datos para calcular.")
        setPrintCardEditandoId(pc.id)
        setNuevoPrintCardProducto(pc.producto)
        setNuevoPrintCardAncho(pc.ancho > 0 ? String(pc.ancho) : anchoCm > 0 ? String(anchoCm) : "")
        setNuevoPrintCardPantones([{ pantone: "", cobertura: "" }])
        setCrearPrintCardOpen(true)
        return
      }

      const resultados = esPruebaManual && pc
        ? await getPrintCardDesdePocketBase(pc, metrosRestantes, anchoParaCalculo, kgBase)
        : await getPrintCardHibrido(codigo, metrosRestantes, anchoParaCalculo, kgBase)
      if (!resultados.length) {
        setPcError(esPruebaManual
          ? "No se encontraron colores en el Print Card de PocketBase"
          : "No se encontraron tintas para ese Print Card")
        return
      }

      setColoresData(resultados.map(color => crearFilaManual(color, returnsMap.get(color.color))))
    } finally {
      setLoadingPC(false)
    }
  }

  function actualizarPantoneNuevo(index: number, campo: keyof PrintCardPantoneInput, valor: string) {
    setNuevoPrintCardPantones(prev => prev.map((row, i) => (
      i === index ? { ...row, [campo]: valor } : row
    )))
  }

  function agregarPantoneNuevo() {
    setNuevoPrintCardPantones(prev => (
      prev.length >= 10 ? prev : [...prev, { pantone: "", cobertura: "" }]
    ))
  }

  function quitarPantoneNuevo(index: number) {
    setNuevoPrintCardPantones(prev => prev.length <= 1 ? prev : prev.filter((_, i) => i !== index))
  }

  async function guardarPrintCardNuevo() {
    const codigo = printCard.trim()
    const anchoNuevo = parseFloat(nuevoPrintCardAncho) || 0
    const filasValidas = nuevoPrintCardPantones
      .map(row => ({
        pantone: row.pantone.trim(),
        cobertura: parseFloat(row.cobertura) || 0,
      }))
      .filter(row => row.pantone && row.cobertura > 0)

    if (!codigo) {
      toast.error("Ingresa un Print Card")
      return
    }
    if (!(anchoNuevo > 0)) {
      toast.error("Ingresa el ancho del material en cm")
      return
    }
    if (!filasValidas.length) {
      toast.error("Agrega al menos un Pantone con cobertura")
      return
    }

    const pcNuevo: PrintCardData = {
      id: printCardEditandoId,
      print_card: codigo,
      producto: nuevoPrintCardProducto.trim(),
      ancho: anchoNuevo,
      maquina: maquinaManualSeleccionada.nombre,
      colores: filasValidas.map(row => row.pantone),
      coberturas: filasValidas.map(row => row.cobertura > 1 ? row.cobertura / 100 : row.cobertura),
    }

    setCreandoPrintCard(true)
    try {
      const creado = await createPrintCard(pcNuevo)
      if (!creado) {
        toast.error("No se pudo crear el Print Card en PocketBase")
        return
      }

      const returnsList = await getInkReturns(impresoraIdDestino)
      const returnsMap = consolidarInkReturnsPorPantone(returnsList)
      const kgBase = maquinaManualSeleccionada.kgBase
      const resultados = await getPrintCardDesdePocketBase(creado, metrosRestantes, creado.ancho, kgBase)

      if (!resultados.length) {
        toast.error("Print Card creado, pero no se encontraron tintas para sus Pantones")
        return
      }

      setInkReturns(returnsMap)
      setAnchoCm(creado.ancho)
      setKgBaseMaquina(kgBase)
      setMaquinaNombre("PocketBase print_cards")
      setColoresData(resultados.map(color => crearFilaManual(color, returnsMap.get(color.color))))
      setPrintCardsCatalogo(prev => (
        prev.some((pc) => pc.print_card === creado.print_card)
          ? prev.map((pc) => pc.print_card === creado.print_card ? creado : pc)
          : [...prev, creado].sort((a, b) => a.print_card.localeCompare(b.print_card))
      ))
      setPcError("")
      setPrintCardEditandoId(undefined)
      setCrearPrintCardOpen(false)
      toast.success(printCardEditandoId ? "Print Card completado y cargado" : "Print Card creado y cargado", {
        description: `${creado.print_card} · ${resultados.length} Pantone${resultados.length === 1 ? "" : "s"}`,
      })
    } finally {
      setCreandoPrintCard(false)
    }
  }

  function actualizarFila(index: number, campo: "kgEnMaquina" | "densidad" | "viscosidad" | "kgSolicitar", valor: string) {
    setColoresData(prev => prev.map((fila, i) => (
      i === index
        ? (() => {
            const actualizada = {
              ...fila,
              [campo]: campo === "densidad" ? parseFloat(valor) || 0 : valor,
            }

            if (campo === "kgSolicitar" || campo === "viscosidad") {
              return actualizada
            }

            if (!fila.calculado) {
              return { ...actualizada, tiempoMin: 999, calculado: false }
            }

            const kgEnMaquina = parseFloat(String(actualizada.kgEnMaquina)) || 0
            const { kgConsumo, kgBase: kgBaseCalculado, kgBruto, kgTinta, kgDisolvente } = calcularKgPorColor(
              metrosRestantes,
              anchoCm,
              actualizada.bcm,
              actualizada.densidad,
              actualizada.cobertura,
              kgBaseMaquina,
              kgEnMaquina
            )
            const tiempoMin = calcularAutonomiaMinutos(actualizada, kgEnMaquina)

            return {
              ...actualizada,
              kgConsumo,
              kgBase: kgBaseCalculado,
              kgBruto,
              kgTinta,
              kgDisolvente,
              kgSolicitar: String(kgTinta),
              tiempoMin,
              calculado: true,
            }
          })()
        : fila
    )))
  }

  function actualizarIdentidadFila(index: number, campo: "color" | "tinta", valor: string) {
    setColoresData(prev => prev.map((fila, i) => (
      i === index ? { ...fila, [campo]: valor } : fila
    )))
  }

  function seleccionarAnilox(index: number, anilox: AniloxCatalogo) {
    setColoresData(prev => prev.map((fila, i) => {
      if (i !== index) return fila

      const actualizada = { ...fila, anilox: anilox.lpi, bcm: anilox.bcm }
      if (!fila.calculado) return actualizada

      const kgEnMaquinaCapturado = parseFloat(fila.kgEnMaquina) || 0
      const kgEnMaquinaFila = kgBaseEnMaquina
        ? Math.max(kgEnMaquinaCapturado, kgBaseMaquina)
        : kgEnMaquinaCapturado
      const { kgConsumo, kgBase: kgBaseCalculado, kgBruto, kgTinta, kgDisolvente } = calcularKgPorColor(
        metrosRestantes,
        anchoCm,
        anilox.bcm,
        fila.densidad,
        fila.cobertura,
        kgBaseMaquina,
        kgEnMaquinaFila
      )
      const tiempoMin = calcularAutonomiaMinutos(actualizada, kgEnMaquinaFila)

      return {
        ...actualizada,
        kgEnMaquina: kgBaseEnMaquina ? String(roundKg(kgEnMaquinaFila)) : fila.kgEnMaquina,
        kgConsumo,
        kgBase: kgBaseCalculado,
        kgBruto,
        kgTinta,
        kgDisolvente,
        kgSolicitar: fila.kgSolicitar || String(kgTinta),
        tiempoMin,
      }
    }))
  }

  function invalidarCalculos() {
    setColoresData(prev => prev.map((fila) => ({ ...fila, tiempoMin: 999, calculado: false })))
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
    if (!(velocidadActual > 0)) {
      toast.error("Ingresa la velocidad de la maquina")
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
      const tiempoMin = calcularAutonomiaMinutos(fila, kgEnMaquinaFila)

      return {
        ...fila,
        kgEnMaquina: kgBaseEnMaquina ? String(roundKg(kgEnMaquinaFila)) : fila.kgEnMaquina,
        kgConsumo,
        kgBase: kgBaseCalculado,
        kgBruto,
        kgTinta,
        kgDisolvente,
        kgSolicitar: fila.kgSolicitar || String(kgTinta),
        tiempoMin,
        calculado: true,
      }
    }))
    toast.success("Calculo actualizado por Pantone")
  }

  function aplicarDepositoEnFila(pantone: string, kgDepositados: number) {
    if (!(kgDepositados > 0)) return

    setColoresData(prev => prev.map((fila) => {
      if (fila.color !== pantone) return fila

      const kgEnMaquina = roundKg((parseFloat(fila.kgEnMaquina) || 0) + kgDepositados)
      const { kgConsumo, kgBase: kgBaseCalculado, kgBruto, kgTinta, kgDisolvente } = calcularKgPorColor(
        metrosRestantes,
        anchoCm,
        fila.bcm,
        fila.densidad,
        fila.cobertura,
        kgBaseMaquina,
        kgEnMaquina
      )
      const tiempoMin = calcularAutonomiaMinutos(fila, kgEnMaquina)

      return {
        ...fila,
        kgEnMaquina: String(kgEnMaquina),
        kgConsumo,
        kgBase: kgBaseCalculado,
        kgBruto,
        kgTinta,
        kgDisolvente,
        kgSolicitar: String(kgTinta),
        tiempoMin,
        calculado: true,
      }
    }))
  }

  function abrirDevolucion(index: number) {
    const color = coloresData[index]
    if (!color) return
    const existing = inkReturns.get(color.color)
    const kgActual = existing?.kg_disponibles ?? (parseFloat(color.kgEnMaquina) || 0)
    setReturnModal({
      color: color.color,
      rowIndex: index,
      existingId: existing?.id,
      existingKg: kgActual,
    })
    setReturnKgInput(kgActual > 0 ? String(kgActual) : "")
  }

  async function confirmarDevolucion() {
    if (!returnModal) return
    const nuevoKg = Math.max(0, parseFloat(returnKgInput) || 0)
    setReturningInk(true)

    try {
      if (nuevoKg === 0) {
        if (returnModal.existingId) {
          await deleteInkReturn(returnModal.existingId)
          setInkReturns(prev => {
            const next = new Map(prev)
            next.delete(returnModal.color)
            return next
          })
          actualizarFila(returnModal.rowIndex, "kgEnMaquina", "0")
        }
      } else if (returnModal.existingId) {
        const updated = await updateInkReturn(returnModal.existingId, nuevoKg)
        if (updated) {
          setInkReturns(prev => new Map(prev).set(returnModal.color, updated))
          if (updated.confirmado) {
            actualizarFila(returnModal.rowIndex, "kgEnMaquina", String(updated.kg_disponibles))
          }
        }
      } else {
        const created = await createInkReturn(impresoraIdDestino, returnModal.color, nuevoKg)
        if (created) {
          setInkReturns(prev => new Map(prev).set(returnModal.color, created))
        }
      }

      toast.success("Devolución registrada", { description: `${returnModal.color} · ${nuevoKg} kg` })
      setReturnModal(null)
      setReturnKgInput("")
    } catch {
      toast.error("Error al registrar la devolución")
    } finally {
      setReturningInk(false)
    }
  }

  function abrirRecepcionDeposito(sol: SolicitudTinta) {
    const kgFabricados = sol.kgFabricados ?? sol.kgAFabricar
    const kgDepositar = Math.min(kgFabricados, sol.kgAFabricar)
    setRecepcionDeposito({
      solicitud: sol,
      kgDepositarInput: String(roundKg(kgDepositar)),
      destinoSobrante: "maquina",
      guardando: false,
    })
  }

  async function confirmarRecepcionDeposito() {
    if (!recepcionDeposito) return

    const { solicitud, destinoSobrante } = recepcionDeposito
    const kgFabricados = solicitud.kgFabricados ?? solicitud.kgAFabricar
    const kgDepositar = roundKg(parseFloat(recepcionDeposito.kgDepositarInput) || 0)

    if (kgDepositar < 0 || kgDepositar > kgFabricados) {
      toast.error("Los kg a depositar no pueden exceder lo fabricado")
      return
    }

    const kgSobrante = roundKg(Math.max(0, kgFabricados - kgDepositar))
    setRecepcionDeposito(prev => prev ? { ...prev, guardando: true } : prev)

    try {
      await confirmarRecepcion(solicitud.id)

      if (kgSobrante > 0) {
        const existente = inkReturns.get(solicitud.color)
        const puedeSumarExistente = !!existente && (destinoSobrante === "maquina" || !existente.confirmado)
        const registro = puedeSumarExistente
          ? await updateInkReturn(
              existente.id,
              roundKg(existente.kg_disponibles + kgSobrante),
              destinoSobrante === "maquina" ? true : existente.confirmado
            )
          : await createInkReturn(
              impresoraIdDestino,
              solicitud.color,
              kgSobrante,
              destinoSobrante === "maquina"
            )

        if (!registro) {
          toast.error("No se pudo registrar el sobrante")
          setRecepcionDeposito(prev => prev ? { ...prev, guardando: false } : prev)
          return
        }
        setInkReturns(prev => new Map(prev).set(solicitud.color, registro))
      }

      await confirmarDeposito(solicitud.id)
      aplicarDepositoEnFila(solicitud.color, kgDepositar)
      setRecepcionDeposito(null)
      toast.success("Tinta recibida y depositada", {
        description: kgSobrante > 0
          ? `${kgDepositar} kg a maquina · ${kgSobrante} kg ${destinoSobrante === "maquina" ? "quedan disponibles" : "a devolucion"}`
          : `${kgDepositar} kg depositados en maquina`,
      })
    } catch {
      toast.error("Error al confirmar recepcion")
      setRecepcionDeposito(prev => prev ? { ...prev, guardando: false } : prev)
    }
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
    if (!color.color.trim()) {
      toast.error("Ingresa el Pantone antes de enviar")
      return
    }
    if (!color.calculado) {
      toast.error("Calcula la fila antes de enviar")
      return
    }
    const kgSolicitados = roundKg(parseFloat(color.kgSolicitar) || color.kgTinta || 0)
    if (!(kgSolicitados > 0)) {
      toast.error("Ingresa los kg de tinta a solicitar para este Pantone")
      return
    }
    if (!(parseFloat(color.viscosidad) > 0)) {
      toast.error("Ingresa la viscosidad para este Pantone")
      return
    }
    if (color.tiempoMin === 999) {
      toast.error("Calcula el tiempo con una velocidad valida antes de enviar")
      return
    }
    if (!printCard.trim()) {
      toast.error("Busca un Print Card primero")
      return
    }

    setColoresData(prev => prev.map((fila, i) => i === index ? { ...fila, enviando: true } : fila))
    await crearSolicitud({
      impresoraId: impresoraIdDestino,
      impresoraNombre: impresoraNombreDestino,
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
      kgAFabricar: kgSolicitados,
      tiempoEstimadoMin: color.tiempoMin,
      urgencia: determinarUrgencia(color.tiempoMin),
    })

    setColoresData(prev => prev.map((fila, i) => i === index ? { ...fila, enviando: false } : fila))
    toast.success("Solicitud enviada a cocina de tintas", {
      description: `${kgSolicitados} kg de ${color.color}`,
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
            {esPruebaManual ? `Maquina de prueba manual - ${impresoraNombreDestino}` : `${impresora.nombre} - Cuerpo ${cuerpoNum}`}
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
                <Popover open={printCardComboboxOpen} onOpenChange={setPrintCardComboboxOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      role="combobox"
                      aria-expanded={printCardComboboxOpen}
                      className="h-10 flex-1 justify-between px-3 font-mono font-normal"
                    >
                      <span className={cn("truncate", !printCard && "font-sans text-muted-foreground")}>
                        {printCard || "Buscar Print Card..."}
                      </span>
                      <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent
                    align="start"
                    className="w-[var(--radix-popover-trigger-width)] p-0"
                  >
                    <Command shouldFilter>
                      <CommandInput
                        value={printCard}
                        onValueChange={setPrintCard}
                        placeholder="Buscar o capturar Print Card..."
                        onKeyDown={(e) => {
                          if (e.key !== "Enter") return
                          e.preventDefault()
                          setPrintCardComboboxOpen(false)
                          void buscarPrintCard()
                        }}
                      />
                      <CommandList>
                        <CommandEmpty>
                          <div className="px-3 py-2 text-sm text-muted-foreground">
                            Sin coincidencias. Captura el codigo y presiona Buscar para darlo de alta.
                          </div>
                        </CommandEmpty>
                        <CommandGroup heading={loadingPrintCards ? "Cargando catalogo..." : "Print Cards"}>
                          {printCardsCatalogo.map((pc) => (
                            <CommandItem
                              key={pc.print_card}
                              value={`${pc.print_card} ${pc.producto} ${pc.maquina} ${pc.colores.join(" ")}`}
                              onSelect={() => {
                                setPrintCard(pc.print_card)
                                if (pc.ancho > 0) setAnchoCm(pc.ancho)
                                setPrintCardComboboxOpen(false)
                              }}
                              className="items-start justify-between gap-3"
                            >
                              <div className="min-w-0">
                                <p className="truncate font-mono text-sm font-semibold">{pc.print_card}</p>
                                <p className="truncate text-xs text-muted-foreground">
                                  {pc.producto || "Sin producto"}
                                  {pc.ancho > 0 ? ` · ${pc.ancho} cm` : ""}
                                  {pc.colores.length > 0 ? ` · ${pc.colores.length} Pantone${pc.colores.length === 1 ? "" : "s"}` : ""}
                                </p>
                              </div>
                              <Check className={cn("mt-0.5 h-4 w-4 shrink-0", printCard === pc.print_card ? "opacity-100" : "opacity-0")} />
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
                <Button type="button" onClick={buscarPrintCard} disabled={loadingPC}>
                  {loadingPC ? <Loader2 className="h-4 w-4 animate-spin" /> : "Buscar"}
                </Button>
              </div>
              {printCardsCatalogo.length > 0 && (
                <p className="mt-2 text-xs text-muted-foreground">
                  {printCardsCatalogo.length} Print Cards disponibles en catalogo
                </p>
              )}
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
                {esPruebaManual && (
                  <div className="flex flex-col gap-2">
                    <Label>Maquina destino</Label>
                    <Select
                      value={maquinaManualId}
                      onValueChange={(value) => {
                        const maquina = MAQUINAS_PRUEBA_MANUAL.find((m) => m.id === value)
                        setMaquinaManualId(value)
                        if (maquina) setKgBaseMaquina(maquina.kgBase)
                        invalidarCalculos()
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Seleccionar maquina" />
                      </SelectTrigger>
                      <SelectContent>
                        {MAQUINAS_PRUEBA_MANUAL.map((maquina) => (
                          <SelectItem key={maquina.id} value={maquina.id}>
                            {maquina.nombre}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
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
            <CardHeader className="flex flex-row items-center justify-between gap-3">
              <div className="min-w-0">
                <CardTitle className="text-base text-foreground">Control de tintas</CardTitle>
                <p className="mt-1 text-xs text-muted-foreground">
                  {controlTintas.length} Pantone{controlTintas.length === 1 ? "" : "s"} · {impresoraNombreDestino}
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 shrink-0 px-2"
                onClick={() => setControlTintasOpen(prev => !prev)}
              >
                <ChevronDown className={cn(
                  "h-4 w-4 transition-transform",
                  controlTintasOpen && "rotate-180"
                )} />
                <span className="ml-1 text-xs">{controlTintasOpen ? "Minimizar" : "Mostrar"}</span>
              </Button>
            </CardHeader>
            {controlTintasOpen && (
              <CardContent>
                <div className="grid gap-px overflow-hidden rounded-lg border bg-border/60 sm:grid-cols-2 xl:grid-cols-4">
                  {controlTintas.map((item) => (
                    <div key={item.color} className="bg-card p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-xs font-semibold text-foreground">{item.color}</p>
                          <p className="mt-0.5 truncate text-[10px] text-muted-foreground">{item.tinta}</p>
                        </div>
                        <Badge variant="outline" className={cn("shrink-0 text-[10px]", item.estado.className)}>
                          {item.estado.label}
                        </Badge>
                      </div>
                      <div className="mt-3 grid grid-cols-3 gap-2 text-[10px]">
                        <div className="rounded-md border bg-background px-2 py-1.5">
                          <p className="text-muted-foreground">Calculado</p>
                          <p className="font-mono font-semibold text-foreground">{formatKg(item.kgCalculado)}</p>
                        </div>
                        <div className="rounded-md border bg-background px-2 py-1.5">
                          <p className="text-muted-foreground">Solicitado</p>
                          <p className="font-mono font-semibold text-foreground">{formatKg(item.kgSolicitado)}</p>
                        </div>
                        <div className="rounded-md border bg-background px-2 py-1.5">
                          <p className="text-muted-foreground">Dif.</p>
                          <p className={cn(
                            "font-mono font-semibold",
                            item.diferencia > 0 ? "text-amber-700 dark:text-amber-400" : item.diferencia < 0 ? "text-red-700 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400"
                          )}>
                            {item.diferencia > 0 ? "+" : ""}{formatKg(item.diferencia)}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            )}
          </Card>
        )}

        {coloresData.length > 0 && (
          <Card className="lg:col-span-3">
            <CardHeader>
              <CardTitle className="text-base text-foreground">Tintas del Print Card</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="min-w-[1340px] w-full text-sm">
                  <thead>
                    <tr className="border-b text-muted-foreground">
                      <th className="w-40 pb-2 text-left font-medium">Color</th>
                      <th className="w-44 pb-2 text-left font-medium">Tinta</th>
                      <th className="w-20 pb-2 text-right font-medium">Cob. %</th>
                      <th className="w-44 pb-2 text-right font-medium">Anilox</th>
                      <th className="w-20 pb-2 text-right font-medium">BCM</th>
                      <th className="w-24 pb-2 text-right font-medium">Dens.</th>
                      <th className="w-28 pb-2 text-right font-medium">Kg maq.</th>
                      <th className="w-32 pb-2 text-center font-medium">Tiempo</th>
                      <th className="w-24 pb-2 text-right font-medium">Visc.</th>
                      <th className="w-28 pb-2 text-right font-medium font-mono">Kg calc.</th>
                      <th className="w-28 pb-2 text-right font-medium font-mono">Kg solicitar</th>
                      <th className="w-40 pb-2 text-right font-medium">Accion</th>
                    </tr>
                  </thead>
                  <tbody>
                    {coloresData.map((color, index) => (
                      <tr key={index} className="border-b last:border-0">
                        <td className="py-2 pr-3 font-medium">
                          <Input
                            value={color.color}
                            onChange={(e) => actualizarIdentidadFila(index, "color", e.target.value)}
                            className={cn(
                              "h-8 w-36 font-mono text-xs font-semibold",
                              !color.color.trim() && "border-amber-400 dark:border-amber-600"
                            )}
                            placeholder="Pantone"
                          />
                          {(() => {
                            const ret = inkReturns.get(color.color)
                            if (!ret || ret.kg_disponibles <= 0) return null
                            return (
                              <p className={ret.confirmado
                                ? "mt-0.5 text-[10px] text-emerald-600 dark:text-emerald-400"
                                : "mt-0.5 text-[10px] text-amber-600 dark:text-amber-400"}
                              >
                                {ret.kg_disponibles} kg {ret.confirmado ? "disponibles" : "pendiente confirmacion"}
                              </p>
                            )
                          })()}
                        </td>
                        <td className="py-2 pr-3">
                          <Input
                            value={color.tinta}
                            onChange={(e) => actualizarIdentidadFila(index, "tinta", e.target.value)}
                            className="h-8 w-40 text-xs text-muted-foreground"
                            placeholder="Nombre tinta"
                          />
                        </td>
                        <td className="py-2 text-right">{(color.cobertura * 100).toFixed(1)}%</td>
                        <td className="py-2 text-right">
                          <Select
                            value={color.anilox > 0 ? String(color.anilox) : ""}
                            onValueChange={(value) => {
                              const item = aniloxCatalogo.find((a) => String(a.lpi) === value)
                              if (item) seleccionarAnilox(index, item)
                            }}
                          >
                            <SelectTrigger className="ml-auto h-8 w-40 font-mono text-xs">
                              <SelectValue placeholder="Seleccionar" />
                            </SelectTrigger>
                            <SelectContent>
                              {aniloxCatalogo.map((a) => (
                                <SelectItem key={a.lpi} value={String(a.lpi)} className="font-mono text-xs">
                                  {a.lpi} LPI - BCM {a.bcm}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="py-2 text-right">{color.bcm || "ND"}</td>
                        <td className="py-2 text-right">
                          <Input
                            type="number"
                            step="0.01"
                            value={color.densidad || ""}
                            onChange={(e) => actualizarFila(index, "densidad", e.target.value)}
                            className={cn(
                              "ml-auto h-8 w-20 text-right font-mono text-xs",
                              !color.densidad && "border-amber-400 dark:border-amber-600"
                            )}
                            placeholder="g/cm³"
                          />
                        </td>
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
                        <td className="py-2 text-center">
                          {color.calculado && color.tiempoMin !== 999 ? (
                            <UrgencyBadge
                              urgencia={determinarUrgencia(color.tiempoMin)}
                              tiempoMin={color.tiempoMin}
                              pulsing
                            />
                          ) : (
                            <span className="text-xs text-muted-foreground/50">--</span>
                          )}
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
                          <Input
                            type="number"
                            step="0.1"
                            value={color.kgSolicitar}
                            onChange={(e) => actualizarFila(index, "kgSolicitar", e.target.value)}
                            className="ml-auto h-8 w-24 text-right font-mono text-xs"
                            placeholder={color.calculado ? String(color.kgTinta) : "kg"}
                          />
                        </td>
                        <td className="py-2 text-right">
                          <div className="flex justify-end gap-2">
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-8"
                              onClick={() => abrirDevolucion(index)}
                            >
                              <Undo2 className="mr-1 h-3 w-3" />
                              Devolver
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              className="h-8"
                              onClick={() => enviarColor(index)}
                              disabled={color.enviando || !color.calculado || !(parseFloat(color.kgSolicitar) > 0 || color.kgTinta > 0)}
                            >
                              {color.enviando ? <Loader2 className="h-3 w-3 animate-spin" /> : <><Send className="mr-1 h-3 w-3" />Enviar</>}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2">
                      <td colSpan={9} className="pt-2 font-bold">TOTAL CALCULADO</td>
                      <td className="pt-2 text-right font-mono font-bold text-foreground text-base">{totalKg} kg</td>
                      <td />
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {notificacionesMaquina.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
            <Activity className="h-4 w-4 text-amber-600" />
            Notificaciones activas
          </h3>
          {notificacionesMaquina.map((n) => (
            <div key={n.id} className="flex items-center gap-2">
              <div className="flex-1">
                <FlashingAlert tipo={n.tipo} mensaje={n.mensaje} timestamp={n.timestamp} leida={n.leida} />
              </div>
              {n.tipo === "fabricado" && (
                <Button
                  size="sm"
                  onClick={() => {
                    const sol = solicitudesMaquina.find(s => s.id === n.solicitudId)
                    if (sol) abrirRecepcionDeposito(sol)
                  }}
                >
                  Confirmar Recepcion
                </Button>
              )}
            </div>
          ))}
        </section>
      )}

      {solicitudesMaquina.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-foreground">Solicitudes activas</h3>
          {solicitudesMaquina.map((s) => (
            <div key={s.id} className="rounded-xl border bg-card px-4 py-3">
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground">{s.id} · Cuerpo {s.cuerpoNumero}</p>
                  <p className="text-xs text-muted-foreground">{s.color} · {s.serieTinta}</p>
                </div>
                <Badge variant="outline" className="font-mono">{s.kgAFabricar} kg</Badge>
                <StatusBadge estado={s.estado} />
                {s.estado === "fabricado" && (
                  <Button size="sm" onClick={() => abrirRecepcionDeposito(s)}>
                    Confirmar Recepcion
                  </Button>
                )}
                {s.estado === "entregado" && (
                  <Button size="sm" variant="outline" onClick={() => void confirmarDeposito(s.id)}>
                    Depositar en Maquina
                  </Button>
                )}
              </div>
            </div>
          ))}
        </section>
      )}

      {recepcionDeposito && (() => {
        const sol = recepcionDeposito.solicitud
        const kgFabricados = sol.kgFabricados ?? sol.kgAFabricar
        const kgDepositar = roundKg(parseFloat(recepcionDeposito.kgDepositarInput) || 0)
        const kgSobrante = roundKg(Math.max(0, kgFabricados - kgDepositar))
        const kgExtra = roundKg(Math.max(0, kgFabricados - sol.kgAFabricar))

        return (
          <Dialog open onOpenChange={(open) => { if (!open && !recepcionDeposito.guardando) setRecepcionDeposito(null) }}>
            <DialogContent className="sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>Recibir y depositar tinta</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-1">
                <div className="rounded-lg border bg-muted/20 px-3 py-2">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-mono text-sm font-semibold text-foreground">{sol.id}</p>
                      <p className="mt-1 text-sm font-semibold text-foreground">{sol.color}</p>
                      <p className="text-xs text-muted-foreground">{sol.serieTinta}</p>
                    </div>
                    {kgExtra > 0 && (
                      <Badge className="bg-amber-600 text-white">
                        Cocina preparo {formatKg(kgExtra)} extra
                      </Badge>
                    )}
                  </div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-3">
                    <div className="rounded-md border bg-background px-3 py-2">
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Solicitado</p>
                      <p className="font-mono text-sm font-semibold">{formatKg(sol.kgAFabricar)}</p>
                    </div>
                    <div className="rounded-md border bg-background px-3 py-2">
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Fabricado</p>
                      <p className="font-mono text-sm font-semibold">{formatKg(kgFabricados)}</p>
                    </div>
                    <div className="rounded-md border bg-background px-3 py-2">
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Sobrante</p>
                      <p className="font-mono text-sm font-semibold">{formatKg(kgSobrante)}</p>
                    </div>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">Kg a depositar en maquina</Label>
                  <Input
                    type="number"
                    min="0"
                    max={kgFabricados}
                    step="0.1"
                    value={recepcionDeposito.kgDepositarInput}
                    onChange={(e) => setRecepcionDeposito(prev => prev ? { ...prev, kgDepositarInput: e.target.value } : prev)}
                    className="font-mono text-right"
                    autoFocus
                  />
                  <p className="text-[10px] text-muted-foreground">
                    Maximo disponible: {formatKg(kgFabricados)}
                  </p>
                </div>

                {kgSobrante > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-medium">Destino del sobrante</p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <button
                        type="button"
                        className={cn(
                          "rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                          recepcionDeposito.destinoSobrante === "maquina"
                            ? "border-emerald-400 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/20 dark:text-emerald-300"
                            : "hover:bg-muted/50"
                        )}
                        onClick={() => setRecepcionDeposito(prev => prev ? { ...prev, destinoSobrante: "maquina" } : prev)}
                      >
                        <span className="font-semibold">Se queda en maquina</span>
                        <span className="mt-0.5 block text-xs opacity-80">Queda disponible para otro trabajo.</span>
                      </button>
                      <button
                        type="button"
                        className={cn(
                          "rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                          recepcionDeposito.destinoSobrante === "cocina"
                            ? "border-amber-400 bg-amber-50 text-amber-800 dark:bg-amber-950/20 dark:text-amber-300"
                            : "hover:bg-muted/50"
                        )}
                        onClick={() => setRecepcionDeposito(prev => prev ? { ...prev, destinoSobrante: "cocina" } : prev)}
                      >
                        <span className="font-semibold">Regresa a cocina</span>
                        <span className="mt-0.5 block text-xs opacity-80">Aparece en devoluciones para confirmar.</span>
                      </button>
                    </div>
                  </div>
                )}

                <div className="flex justify-end gap-2">
                  <Button variant="outline" size="sm" onClick={() => setRecepcionDeposito(null)} disabled={recepcionDeposito.guardando}>
                    Cancelar
                  </Button>
                  <Button size="sm" onClick={() => void confirmarRecepcionDeposito()} disabled={recepcionDeposito.guardando || kgDepositar < 0 || kgDepositar > kgFabricados}>
                    {recepcionDeposito.guardando ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
                    Confirmar deposito
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        )
      })()}

      {returnModal && (
        <Dialog open onOpenChange={(open) => { if (!open) { setReturnModal(null); setReturnKgInput("") } }}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>Devolver tinta sobrante</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-1">
              <div>
                <p className="text-sm font-semibold">{returnModal.color}</p>
                {returnModal.existingKg > 0 && (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Actualmente registrado: {returnModal.existingKg} kg disponibles
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Kg disponibles en maquina</Label>
                <Input
                  type="number"
                  step="0.1"
                  min="0"
                  value={returnKgInput}
                  onChange={(e) => setReturnKgInput(e.target.value)}
                  placeholder="0.0"
                  className="font-mono"
                  autoFocus
                  onKeyDown={(e) => { if (e.key === "Enter") void confirmarDevolucion() }}
                />
                <p className="text-[10px] text-muted-foreground">
                  {parseFloat(returnKgInput) === 0 && returnModal.existingId
                    ? "El registro se eliminara."
                    : "Quedara pendiente de confirmacion por cocina antes de usarse en el calculo."}
                </p>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => { setReturnModal(null); setReturnKgInput("") }}>
                  Cancelar
                </Button>
                <Button size="sm" onClick={() => void confirmarDevolucion()} disabled={returningInk}>
                  {returningInk ? <Loader2 className="h-3 w-3 animate-spin" /> : "Confirmar"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      <Dialog
        open={crearPrintCardOpen}
        onOpenChange={(open) => {
          setCrearPrintCardOpen(open)
          if (!open) setPrintCardEditandoId(undefined)
        }}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{printCardEditandoId ? "Completar Print Card en PocketBase" : "Crear Print Card en PocketBase"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-1">
            <div className="rounded-lg border bg-muted/20 px-3 py-2">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Print Card</p>
              <p className="font-mono text-sm font-semibold text-foreground">{printCard.trim() || "--"}</p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="nuevoProducto">Producto</Label>
                <Input
                  id="nuevoProducto"
                  value={nuevoPrintCardProducto}
                  onChange={(e) => setNuevoPrintCardProducto(e.target.value)}
                  placeholder="Nombre del producto"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="nuevoAncho">Ancho impresion (cm)</Label>
                <Input
                  id="nuevoAncho"
                  type="number"
                  step="0.1"
                  value={nuevoPrintCardAncho}
                  onChange={(e) => setNuevoPrintCardAncho(e.target.value)}
                  placeholder="Ej. 95.5"
                  className="font-mono"
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <Label>Pantones del Print Card</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={agregarPantoneNuevo}
                  disabled={nuevoPrintCardPantones.length >= 10}
                >
                  <Plus className="mr-1 h-3 w-3" />
                  Agregar
                </Button>
              </div>
              <div className="space-y-2">
                {nuevoPrintCardPantones.map((row, index) => (
                  <div key={index} className="grid gap-2 sm:grid-cols-[1fr_120px_auto]">
                    <Input
                      value={row.pantone}
                      onChange={(e) => actualizarPantoneNuevo(index, "pantone", e.target.value)}
                      placeholder="Ej. PANTONE 286 C"
                      className="font-mono"
                    />
                    <Input
                      type="number"
                      step="0.1"
                      value={row.cobertura}
                      onChange={(e) => actualizarPantoneNuevo(index, "cobertura", e.target.value)}
                      placeholder="Cob. %"
                      className="font-mono text-right"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-10 w-10"
                      onClick={() => quitarPantoneNuevo(index)}
                      disabled={nuevoPrintCardPantones.length <= 1}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-muted-foreground">
                La cobertura se captura como porcentaje. Ejemplo: escribe 30 para 30%.
              </p>
            </div>

            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setCrearPrintCardOpen(false)
                  setPrintCardEditandoId(undefined)
                }}
                disabled={creandoPrintCard}
              >
                Cancelar
              </Button>
              <Button onClick={() => void guardarPrintCardNuevo()} disabled={creandoPrintCard}>
                {creandoPrintCard ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
                Guardar y cargar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
