"use client"

import { useState, useEffect } from "react"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { Separator } from "@/components/ui/separator"

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
    <header className="sticky top-0 z-30 flex h-12 items-center gap-3 border-b bg-background/80 backdrop-blur-sm px-4">
      <SidebarTrigger className="h-7 w-7 text-muted-foreground hover:text-foreground" />
      <Separator orientation="vertical" className="h-4" />
      <span className="flex-1 text-xs text-muted-foreground font-mono capitalize hidden sm:block">
        {dateStr}
      </span>
    </header>
  )
}
