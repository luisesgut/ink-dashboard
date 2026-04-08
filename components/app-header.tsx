"use client"

import { useState, useEffect } from "react"
import { SidebarTrigger } from "@/components/ui/sidebar"

export function AppHeader() {
  const [dateStr, setDateStr] = useState("")

  useEffect(() => {
    setDateStr(
      new Date().toLocaleDateString("es-MX", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    )
  }, [])

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-4 border-b bg-card px-4 lg:px-6">
      <SidebarTrigger />
      <div className="flex flex-1 items-center justify-between">
        <h1 className="text-sm font-semibold text-foreground lg:text-base">
          InkBFX - Control de Tintas
        </h1>
        <div className="flex items-center gap-2 text-xs text-muted-foreground font-mono">
          <span className="hidden sm:inline">{dateStr}</span>
        </div>
      </div>
    </header>
  )
}
