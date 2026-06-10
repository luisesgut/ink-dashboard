"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  HubConnection,
  HubConnectionBuilder,
  HubConnectionState,
  LogLevel,
} from "@microsoft/signalr"

export interface TintasDTO {
  prensa: string
  orden: string
  printCard: string
  pedidoVenta: string
  producto: string
  cantidadSolicitada: string
  cantidadProducida: string
  cantidadFaltante: string
  porcentaje: number
  // Campos calculados y limpios por el backend
  metrosSolicitados: number
  metrosFaltantes: number
  requiereIngresoManual: boolean
}

const HUB_URL =
  process.env.NEXT_PUBLIC_TABLERO_HUB_URL ?? "http://172.16.10.31/tableroImpresionHub"

function normalizePrensa(prensa?: string | null): string | null {
  if (!prensa) return null
  const numeric = prensa.replace(/\D/g, "")
  if (!numeric) return null
  return numeric.padStart(2, "0")
}

function toTintasArray(payload: unknown): TintasDTO[] {
  if (!Array.isArray(payload)) return []

  return payload
    .map((item) => {
      const value = item as Partial<TintasDTO>
      return {
        prensa: String(value.prensa ?? ""),
        orden: String(value.orden ?? ""),
        printCard: String(value.printCard ?? ""),
        pedidoVenta: String(value.pedidoVenta ?? ""),
        producto: String(value.producto ?? ""),
        cantidadSolicitada: String(value.cantidadSolicitada ?? ""),
        cantidadProducida: String(value.cantidadProducida ?? ""),
        cantidadFaltante: String(value.cantidadFaltante ?? ""),
        porcentaje:
          typeof value.porcentaje === "number"
            ? value.porcentaje
            : Number(value.porcentaje ?? 0),
        metrosSolicitados:
          typeof value.metrosSolicitados === "number"
            ? value.metrosSolicitados
            : Number(value.metrosSolicitados ?? 0),
        metrosFaltantes:
          typeof value.metrosFaltantes === "number"
            ? value.metrosFaltantes
            : Number(value.metrosFaltantes ?? 0),
        requiereIngresoManual: Boolean(value.requiereIngresoManual ?? false),
      }
    })
    .filter((item) => item.prensa.length > 0)
}

function toStateLabel(state: HubConnectionState): string {
  return HubConnectionState[state] ?? "Disconnected"
}

export function useTableroHub(prensa?: string) {
  const normalizedPrensa = useMemo(() => normalizePrensa(prensa), [prensa])
  const connectionRef = useRef<HubConnection | null>(null)
  const subscribedPrensaRef = useRef<string | null>(null)
  const requestedPrensaRef = useRef<string | null>(normalizedPrensa)

  const [datos, setDatos] = useState<TintasDTO[]>([])
  const [connectionState, setConnectionState] = useState("Disconnected")
  const [hasSynced, setHasSynced] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // Avoid rendering stale rows from the previous machine while the new subscription resolves.
    setDatos([])
    setHasSynced(false)
    setError(null)
    requestedPrensaRef.current = normalizedPrensa
  }, [normalizedPrensa])

  const suscribirPrensa = useCallback(async (targetPrensa: string) => {
    const connection = connectionRef.current
    if (!connection || connection.state !== HubConnectionState.Connected) return

    const normalized = normalizePrensa(targetPrensa)
    if (!normalized) return

    await connection.invoke("SuscribirPrensa", normalized)
    subscribedPrensaRef.current = normalized
  }, [])

  const desuscribirPrensa = useCallback(async (targetPrensa: string) => {
    const connection = connectionRef.current
    if (!connection || connection.state !== HubConnectionState.Connected) return

    const normalized = normalizePrensa(targetPrensa)
    if (!normalized) return

    await connection.invoke("DesuscribirPrensa", normalized)
    if (subscribedPrensaRef.current === normalized) {
      subscribedPrensaRef.current = null
    }
  }, [])

  useEffect(() => {
    const connection = new HubConnectionBuilder()
      .withUrl(HUB_URL)
      .withAutomaticReconnect()
      .configureLogging(LogLevel.Warning)
      .build()

    connectionRef.current = connection

    connection.on("TableroUpdate", (payload: unknown) => {
      const rows = toTintasArray(payload)
      const requestedPrensa = requestedPrensaRef.current
      setDatos(
        requestedPrensa
          ? rows.filter((row) => normalizePrensa(row.prensa) === requestedPrensa)
          : rows
      )
      setHasSynced(true)
    })

    connection.onreconnecting(() => {
      setConnectionState("Reconnecting")
      setHasSynced(false)
      setError(null)
    })

    connection.onreconnected(async () => {
      setConnectionState("Connected")
      setError(null)

      if (subscribedPrensaRef.current) {
        try {
          await connection.invoke("SuscribirPrensa", subscribedPrensaRef.current)
        } catch {
          setError("No fue posible restablecer suscripcion de prensa")
        }
      }
    })

    connection.onclose((err) => {
      setConnectionState("Disconnected")
      if (err) {
        setError("Conexion con tablero cerrada")
      }
    })

    let disposed = false
    const start = async () => {
      setConnectionState("Connecting")
      setError(null)
      try {
        await connection.start()
        if (disposed) return

        setConnectionState(toStateLabel(connection.state))
        if (normalizedPrensa) {
          await connection.invoke("SuscribirPrensa", normalizedPrensa)
          subscribedPrensaRef.current = normalizedPrensa
        }
      } catch {
        if (!disposed) {
          setConnectionState("Disconnected")
          setError("No fue posible conectar al tablero en tiempo real")
        }
      }
    }

    void start()

    return () => {
      disposed = true

      void (async () => {
        try {
          if (
            connection.state === HubConnectionState.Connected &&
            subscribedPrensaRef.current
          ) {
            await connection.invoke("DesuscribirPrensa", subscribedPrensaRef.current)
          }
        } catch {
          // no-op
        } finally {
          subscribedPrensaRef.current = null
          connection.off("TableroUpdate")
          await connection.stop()
          connectionRef.current = null
        }
      })()
    }
  }, [normalizedPrensa])

  useEffect(() => {
    const connection = connectionRef.current
    if (!connection || connection.state !== HubConnectionState.Connected) return

    let cancelled = false

    const syncSubscription = async () => {
      const current = subscribedPrensaRef.current

      if (current && current !== normalizedPrensa) {
        try {
          await connection.invoke("DesuscribirPrensa", current)
          if (!cancelled) {
            subscribedPrensaRef.current = null
          }
        } catch {
          if (!cancelled) setError("No fue posible desuscribir la prensa anterior")
        }
      }

      if (normalizedPrensa && normalizedPrensa !== subscribedPrensaRef.current) {
        try {
          await connection.invoke("SuscribirPrensa", normalizedPrensa)
          if (!cancelled) {
            subscribedPrensaRef.current = normalizedPrensa
          }
        } catch {
          if (!cancelled) setError("No fue posible suscribir la prensa seleccionada")
        }
      }
    }

    void syncSubscription()

    return () => {
      cancelled = true
    }
  }, [normalizedPrensa])

  return {
    datos,
    connectionState,
    hasSynced,
    error,
    suscribirPrensa,
    desuscribirPrensa,
  }
}
