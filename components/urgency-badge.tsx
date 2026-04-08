import { cn } from "@/lib/utils"
import type { NivelUrgencia } from "@/lib/mock-data"
import { getUrgenciaLabel } from "@/lib/mock-data"

const urgencyStyles: Record<NivelUrgencia, string> = {
  rojo: "bg-urgency-red text-white",
  naranja: "bg-urgency-orange text-white",
  verde: "bg-urgency-green text-white",
}

export function UrgencyBadge({
  urgencia,
  tiempoMin,
  className,
  pulsing = false,
}: {
  urgencia: NivelUrgencia
  tiempoMin?: number
  className?: string
  pulsing?: boolean
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold uppercase tracking-wide",
        urgencyStyles[urgencia],
        pulsing && urgencia === "rojo" && "animate-pulse-urgency",
        className
      )}
    >
      <span
        className={cn(
          "h-2 w-2 rounded-full",
          urgencia === "rojo" && "bg-white/80",
          urgencia === "naranja" && "bg-white/80",
          urgencia === "verde" && "bg-white/80"
        )}
      />
      {getUrgenciaLabel(urgencia)}
      {tiempoMin !== undefined && (
        <span className="font-mono">{tiempoMin}min</span>
      )}
    </span>
  )
}
