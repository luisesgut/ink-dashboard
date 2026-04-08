"use client"

import { useState, useEffect } from "react"
import { cn } from "@/lib/utils"
import { Bell, CheckCircle2 } from "lucide-react"

export function FlashingAlert({
  tipo,
  mensaje,
  timestamp,
  leida,
  className,
}: {
  tipo: "fabricando" | "fabricado"
  mensaje: string
  timestamp: Date
  leida: boolean
  className?: string
}) {
  const [timeStr, setTimeStr] = useState("")

  useEffect(() => {
    setTimeStr(
      timestamp.toLocaleTimeString("es-MX", {
        hour: "2-digit",
        minute: "2-digit",
      })
    )
  }, [timestamp])

  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-lg border p-4 transition-all",
        tipo === "fabricando" && !leida && "border-amber-300 bg-amber-50",
        tipo === "fabricado" && !leida && "animate-flash border-emerald-400 bg-emerald-50",
        leida && "border-border bg-muted/50 opacity-60",
        className
      )}
    >
      <div
        className={cn(
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-full",
          tipo === "fabricando" && "bg-amber-100 text-amber-600",
          tipo === "fabricado" && "bg-emerald-100 text-emerald-600"
        )}
      >
        {tipo === "fabricando" ? (
          <Bell className="h-5 w-5" />
        ) : (
          <CheckCircle2 className="h-5 w-5" />
        )}
      </div>
      <div className="flex-1">
        <p
          className={cn(
            "text-sm font-semibold",
            tipo === "fabricando" && "text-amber-800",
            tipo === "fabricado" && "text-emerald-800",
            leida && "text-muted-foreground"
          )}
        >
          {tipo === "fabricando" ? "FABRICANDO" : "FABRICADO"}
        </p>
        <p
          className={cn(
            "text-sm",
            leida ? "text-muted-foreground" : "text-foreground"
          )}
        >
          {mensaje}
        </p>
      </div>
      <span className="shrink-0 text-xs text-muted-foreground">{timeStr}</span>
    </div>
  )
}
