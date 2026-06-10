export type LiveDeadlineTone = "muted" | "green" | "amber" | "red" | "expired"

export interface LiveDeadline {
  hasDeadline: boolean
  deadlineMs: number | null
  remainingMs: number | null
  expiredMs: number
  isExpired: boolean
  label: string
  value: string
  tone: LiveDeadlineTone
  sortValue: number
}

function formatClock(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
  }

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
}

export function getLiveDeadline(
  created: Date | string,
  estimatedMinutes: number,
  nowMs: number = Date.now()
): LiveDeadline {
  const createdMs = created instanceof Date ? created.getTime() : new Date(created).getTime()

  if (!Number.isFinite(createdMs) || !estimatedMinutes || estimatedMinutes === 999) {
    return {
      hasDeadline: false,
      deadlineMs: null,
      remainingMs: null,
      expiredMs: 0,
      isExpired: false,
      label: "Sin tiempo estimado",
      value: "--",
      tone: "muted",
      sortValue: Number.POSITIVE_INFINITY,
    }
  }

  const deadlineMs = createdMs + estimatedMinutes * 60_000
  const remainingMs = deadlineMs - nowMs
  const isExpired = remainingMs <= 0
  const absMs = Math.abs(remainingMs)
  const remainingMinutes = remainingMs / 60_000

  let tone: LiveDeadlineTone = "green"
  if (isExpired) tone = "expired"
  else if (remainingMinutes <= 3) tone = "red"
  else if (remainingMinutes <= 10) tone = "amber"

  return {
    hasDeadline: true,
    deadlineMs,
    remainingMs,
    expiredMs: isExpired ? absMs : 0,
    isExpired,
    label: isExpired ? "Vencido hace" : "Vence en",
    value: formatClock(absMs),
    tone,
    sortValue: remainingMs,
  }
}

export function getResponseMinutes(created: Date | string, completed?: Date | string): number | null {
  if (!completed) return null
  const createdMs = created instanceof Date ? created.getTime() : new Date(created).getTime()
  const completedMs = completed instanceof Date ? completed.getTime() : new Date(completed).getTime()
  if (!Number.isFinite(createdMs) || !Number.isFinite(completedMs)) return null
  return Math.max(0, Math.round((completedMs - createdMs) / 60_000))
}
