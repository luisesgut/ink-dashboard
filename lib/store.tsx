"use client"

import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react"
import {
  type SolicitudTinta,
  type Notificacion,
  type Impresora,
  type RegistroHistorial,
} from "./mock-data"

const PB_URL = process.env.NEXT_PUBLIC_POCKETBASE_URL || "http://127.0.0.1:8090"

// Mappers PocketBase <-> SolicitudTinta
function pbToSolicitud(r: Record<string, unknown>): SolicitudTinta {
  return {
    id: r.id as string,
    timestamp: new Date(r.created as string),
    impresoraId: r.impresora_id as string,
    impresoraNombre: r.impresora_nombre as string,
    cuerpoNumero: r.cuerpo_numero as number,
    color: r.color as string,
    serieTinta: r.serie_tinta as string,
    kgEnMaquina: r.kg_en_maquina as number,
    metrosRestantes: r.metros_restantes as number,
    superficiePorcentaje: r.superficie_porcentaje as number,
    aniloxLineatura: r.anilox_lineatura as number,
    aniloxVolumen: r.anilox_volumen as number,
    velocidadActual: r.velocidad_actual as number,
    viscosidadActual: r.viscosidad as number,
    anchoImpresion: r.ancho_impresion as number,
    kgAFabricar: r.kg_a_fabricar as number,
    tiempoEstimadoMin: r.tiempo_estimado_min as number,
    urgencia: r.urgencia as "rojo" | "naranja" | "verde",
    estado: r.estado as "pendiente" | "fabricando" | "fabricado" | "entregado",
    kgFabricados: r.kg_fabricados as number | undefined,
    timestampFabricando: r.timestamp_fabricando ? new Date(r.timestamp_fabricando as string) : undefined,
    timestampFabricado: r.timestamp_fabricado ? new Date(r.timestamp_fabricado as string) : undefined,
    timestampEntregado: r.timestamp_entregado ? new Date(r.timestamp_entregado as string) : undefined,
  }
}

function solicitudToPb(sol: Omit<SolicitudTinta, "id" | "timestamp" | "estado">) {
  return {
    impresora_id: sol.impresoraId,
    impresora_nombre: sol.impresoraNombre,
    cuerpo_numero: sol.cuerpoNumero,
    color: sol.color,
    serie_tinta: sol.serieTinta,
    kg_en_maquina: sol.kgEnMaquina,
    metros_restantes: sol.metrosRestantes,
    superficie_porcentaje: sol.superficiePorcentaje,
    anilox_lineatura: sol.aniloxLineatura,
    anilox_volumen: sol.aniloxVolumen,
    velocidad_actual: sol.velocidadActual,
    viscosidad: sol.viscosidadActual,
    ancho_impresion: sol.anchoImpresion,
    kg_a_fabricar: sol.kgAFabricar,
    tiempo_estimado_min: sol.tiempoEstimadoMin,
    urgencia: sol.urgencia,
    estado: "pendiente",
    kg_fabricados: 0,
  }
}

interface InkStore {
  solicitudes: SolicitudTinta[]
  notificaciones: Notificacion[]
  impresoras: Impresora[]
  historial: RegistroHistorial[]
  loading: boolean
  crearSolicitud: (sol: Omit<SolicitudTinta, "id" | "timestamp" | "estado">) => Promise<void>
  marcarFabricando: (solId: string) => Promise<void>
  marcarFabricado: (solId: string, kgReales: number) => Promise<void>
  confirmarRecepcion: (solId: string) => Promise<void>
  marcarNotificacionLeida: (notId: string) => void
  marcarTodasLeidas: () => void
  getSolicitudesPorMaquina: (maquinaId: string) => SolicitudTinta[]
  getNotificacionesPorMaquina: (maquinaId: string) => Notificacion[]
  getNotificacionesSinLeer: () => number
  refetch: () => Promise<void>
}

const InkContext = createContext<InkStore | null>(null)

let nextNotId = 100

export function InkProvider({ children }: { children: ReactNode }) {
  const [solicitudes, setSolicitudes] = useState<SolicitudTinta[]>([])
  const [notificaciones, setNotificaciones] = useState<Notificacion[]>([])
  const [impresoras, setImpresoras] = useState<Impresora[]>([])
  const [historial, setHistorial] = useState<RegistroHistorial[]>([])
  const [loading, setLoading] = useState(false)

  // Cargar solicitudes de PocketBase
  const fetchSolicitudes = useCallback(async () => {
    try {
      const res = await fetch(
        `${PB_URL}/api/collections/solicitudes/records?sort=-created&filter=(estado!='entregado')&perPage=100`
      )
      if (!res.ok) return
      const data = await res.json()
      setSolicitudes(data.items.map(pbToSolicitud))
    } catch (e) {
      console.error("Error fetching solicitudes:", e)
    }
  }, [])

  // Cargar al montar
  useEffect(() => {
    fetchSolicitudes()
  }, [fetchSolicitudes])

  // Polling cada 3 segundos para tiempo real
  useEffect(() => {
    const interval = setInterval(fetchSolicitudes, 3000)
    return () => clearInterval(interval)
  }, [fetchSolicitudes])

  const crearSolicitud = useCallback(async (sol: Omit<SolicitudTinta, "id" | "timestamp" | "estado">) => {
    try {
      const res = await fetch(`${PB_URL}/api/collections/solicitudes/records`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(solicitudToPb(sol)),
      })
      if (!res.ok) {
        console.error("Error creando solicitud:", await res.text())
        return
      }
      await fetchSolicitudes()
    } catch (e) {
      console.error("Error:", e)
    }
  }, [fetchSolicitudes])

  const marcarFabricando = useCallback(async (solId: string) => {
    try {
      await fetch(`${PB_URL}/api/collections/solicitudes/records/${solId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          estado: "fabricando",
          timestamp_fabricando: new Date().toISOString(),
        }),
      })

      // Notificación local
      const sol = solicitudes.find(s => s.id === solId)
      if (sol) {
        nextNotId++
        setNotificaciones(prev => [{
          id: `NOT-${String(nextNotId).padStart(3, "0")}`,
          impresoraId: sol.impresoraId,
          impresoraNombre: sol.impresoraNombre,
          solicitudId: sol.id,
          color: sol.color,
          tipo: "fabricando",
          mensaje: `Su tinta ${sol.color} se esta fabricando`,
          timestamp: new Date(),
          leida: false,
        }, ...prev])
      }

      await fetchSolicitudes()
    } catch (e) {
      console.error("Error:", e)
    }
  }, [solicitudes, fetchSolicitudes])

  const marcarFabricado = useCallback(async (solId: string, kgReales: number) => {
    try {
      await fetch(`${PB_URL}/api/collections/solicitudes/records/${solId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          estado: "fabricado",
          kg_fabricados: kgReales,
          timestamp_fabricado: new Date().toISOString(),
        }),
      })

      const sol = solicitudes.find(s => s.id === solId)
      if (sol) {
        nextNotId++
        setNotificaciones(prev => [{
          id: `NOT-${String(nextNotId).padStart(3, "0")}`,
          impresoraId: sol.impresoraId,
          impresoraNombre: sol.impresoraNombre,
          solicitudId: sol.id,
          color: sol.color,
          tipo: "fabricado",
          mensaje: `Tinta ${sol.color} lista - ${kgReales} kg - Confirmar recepcion`,
          timestamp: new Date(),
          leida: false,
        }, ...prev])
      }

      await fetchSolicitudes()
    } catch (e) {
      console.error("Error:", e)
    }
  }, [solicitudes, fetchSolicitudes])

  const confirmarRecepcion = useCallback(async (solId: string) => {
    try {
      await fetch(`${PB_URL}/api/collections/solicitudes/records/${solId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          estado: "entregado",
          timestamp_entregado: new Date().toISOString(),
        }),
      })

      setNotificaciones(prev => prev.map(n => n.solicitudId === solId ? { ...n, leida: true } : n))

      // Agregar al historial local
      const sol = solicitudes.find(s => s.id === solId)
      if (sol) {
        setHistorial(prev => [{
          id: `HIS-${Date.now()}`,
          fechaSolicitud: sol.timestamp,
          fechaCompletado: new Date(),
          impresoraNombre: sol.impresoraNombre,
          color: sol.color,
          serieTinta: sol.serieTinta,
          kgSolicitados: sol.kgAFabricar,
          kgFabricados: sol.kgFabricados || sol.kgAFabricar,
          tiempoUrgenciaOriginal: sol.tiempoEstimadoMin,
          tiempoRealFabricacion: sol.timestampFabricado
            ? Math.round((sol.timestampFabricado.getTime() - (sol.timestampFabricando?.getTime() || sol.timestamp.getTime())) / 60000)
            : 0,
          estado: (sol.kgFabricados || 0) > sol.kgAFabricar + 0.5 ? "retorno_parcial" : "completado",
        }, ...prev])
      }

      await fetchSolicitudes()
    } catch (e) {
      console.error("Error:", e)
    }
  }, [solicitudes, fetchSolicitudes])

  const marcarNotificacionLeida = useCallback((notId: string) => {
    setNotificaciones(prev => prev.map(n => n.id === notId ? { ...n, leida: true } : n))
  }, [])

  const marcarTodasLeidas = useCallback(() => {
    setNotificaciones(prev => prev.map(n => ({ ...n, leida: true })))
    setImpresoras(prev => prev.map(imp => ({ ...imp, tieneNotificacion: false })))
  }, [])

  const getSolicitudesPorMaquina = useCallback(
    (maquinaId: string) => solicitudes.filter(s => s.impresoraId === maquinaId),
    [solicitudes]
  )

  const getNotificacionesPorMaquina = useCallback(
    (maquinaId: string) => notificaciones.filter(n => n.impresoraId === maquinaId),
    [notificaciones]
  )

  const getNotificacionesSinLeer = useCallback(
    () => notificaciones.filter(n => !n.leida).length,
    [notificaciones]
  )

  return (
    <InkContext.Provider value={{
      solicitudes,
      notificaciones,
      impresoras,
      historial,
      loading,
      crearSolicitud,
      marcarFabricando,
      marcarFabricado,
      confirmarRecepcion,
      marcarNotificacionLeida,
      marcarTodasLeidas,
      getSolicitudesPorMaquina,
      getNotificacionesPorMaquina,
      getNotificacionesSinLeer,
      refetch: fetchSolicitudes,
    }}>
      {children}
    </InkContext.Provider>
  )
}

export function useInkStore() {
  const ctx = useContext(InkContext)
  if (!ctx) throw new Error("useInkStore must be used within InkProvider")
  return ctx
}