import { cn } from "@/lib/utils"
import type { EstadoSolicitud } from "@/lib/mock-data"
import { getEstadoLabel } from "@/lib/mock-data"

const statusStyles: Record<EstadoSolicitud, string> = {
  pendiente: "bg-muted text-muted-foreground border-border",
  fabricando: "bg-amber-100 text-amber-800 border-amber-300",
  fabricado: "bg-emerald-100 text-emerald-800 border-emerald-300",
  entregado: "bg-primary/10 text-primary border-primary/30",
  depositado: "bg-violet-100 text-violet-800 border-violet-300 dark:bg-violet-900/20 dark:text-violet-400 dark:border-violet-700",
}

export function StatusBadge({
  estado,
  className,
}: {
  estado: EstadoSolicitud
  className?: string

  
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-semibold",
        statusStyles[estado],
        estado === "fabricando" && "animate-pulse",
        className
      )}
    >
      {estado === "fabricando" && (
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-500 opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-600" />
        </span>
      )}
      {estado === "fabricado" && (
        <span className="h-2 w-2 rounded-full bg-emerald-500" />
      )}
      {getEstadoLabel(estado)}
    </span>
  )
}
