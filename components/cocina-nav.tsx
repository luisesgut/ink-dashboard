"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useCallback, useEffect, useState } from "react"
import { CheckCircle2, FlaskConical, Undo2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { getPendingInkReturns } from "@/lib/pocketbase"
import { cn } from "@/lib/utils"

export function CocinaNav() {
  const pathname = usePathname()
  const [pendingReturns, setPendingReturns] = useState(0)

  const fetchPendingReturns = useCallback(async () => {
    const pending = await getPendingInkReturns()
    setPendingReturns(pending.length)
  }, [])

  useEffect(() => {
    void fetchPendingReturns()
    const interval = window.setInterval(() => void fetchPendingReturns(), 5000)
    return () => window.clearInterval(interval)
  }, [fetchPendingReturns])

  const hasPendingReturns = pendingReturns > 0

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border bg-background p-2 shadow-sm">
      <Button
        asChild
        size="sm"
        variant={pathname === "/cocina" ? "default" : "outline"}
        className="h-9"
      >
        <Link href="/cocina">
          <FlaskConical className="mr-2 h-4 w-4" />
          Cocina
        </Link>
      </Button>

      <Button
        asChild
        size="sm"
        variant={pathname === "/devoluciones" ? "default" : "outline"}
        className={cn(
          "h-9",
          hasPendingReturns &&
            pathname !== "/devoluciones" &&
            "border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 hover:text-amber-900"
        )}
      >
        <Link href="/devoluciones">
          {hasPendingReturns ? (
            <Undo2 className="mr-2 h-4 w-4" />
          ) : (
            <CheckCircle2 className="mr-2 h-4 w-4" />
          )}
          Devoluciones
          {hasPendingReturns && (
            <Badge className="ml-2 h-5 min-w-5 rounded-full bg-amber-600 px-1.5 text-[11px] text-white hover:bg-amber-600">
              {pendingReturns}
            </Badge>
          )}
        </Link>
      </Button>
    </div>
  )
}
