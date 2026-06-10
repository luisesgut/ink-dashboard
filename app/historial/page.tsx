"use client"

import { useEffect, useMemo, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts"
import {
  ClipboardList,
  Droplets,
  AlertTriangle,
  Clock,
  LoaderCircle,
  RefreshCw,
  Search,
  ChevronLeft,
  ChevronRight,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { getResponseMinutes } from "@/lib/live-deadline"

const PB_URL = process.env.NEXT_PUBLIC_POCKETBASE_URL || "http://127.0.0.1:8090"
const PAGE_SIZE = 25

interface Solicitud {
  id: string
  created: string
  impresora_nombre: string
  color: string
  serie_tinta: string
  kg_a_fabricar: number
  kg_fabricados: number
  urgencia: "rojo" | "naranja" | "verde"
  estado: string
  tiempo_estimado_min: number
  timestamp_fabricando?: string
  timestamp_fabricado?: string
  timestamp_entregado?: string
  timestamp_depositado?: string
}

type Periodo = "hoy" | "7dias" | "30dias" | "todo"

const URGENCIA_LABEL: Record<string, string> = {
  rojo: "Urgente",
  naranja: "Moderado",
  verde: "Normal",
}

const ESTADO_LABEL: Record<string, string> = {
  pendiente: "En espera",
  fabricando: "Fabricando",
  fabricado: "Fabricado",
  entregado: "Entregado",
  depositado: "Depositado",
}

const ESTADO_CLASS: Record<string, string> = {
  pendiente: "bg-muted text-muted-foreground border-border",
  fabricando: "bg-amber-100 text-amber-800 border-amber-300",
  fabricado: "bg-emerald-100 text-emerald-800 border-emerald-300",
  entregado: "bg-primary/10 text-primary border-primary/30",
  depositado: "bg-violet-100 text-violet-800 border-violet-300",
}

function tiempoFabricacion(s: Solicitud): number | null {
  return getResponseMinutes(s.created, s.timestamp_fabricado)
}

function formatFecha(iso: string): string {
  return new Date(iso).toLocaleString("es-MX", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function inicioDelPeriodo(periodo: Periodo): Date | null {
  const ahora = new Date()
  if (periodo === "hoy") {
    return new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate())
  }
  if (periodo === "7dias") {
    return new Date(ahora.getTime() - 7 * 24 * 3600 * 1000)
  }
  if (periodo === "30dias") {
    return new Date(ahora.getTime() - 30 * 24 * 3600 * 1000)
  }
  return null
}

export default function HistorialPage() {
  const [solicitudes, setSolicitudes] = useState<Solicitud[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastFetch, setLastFetch] = useState<Date | null>(null)

  const [periodo, setPeriodo] = useState<Periodo>("7dias")
  const [filtroMaquina, setFiltroMaquina] = useState("todas")
  const [filtroUrgencia, setFiltroUrgencia] = useState("todas")
  const [filtroEstado, setFiltroEstado] = useState("completadas")
  const [busqueda, setBusqueda] = useState("")
  const [pagina, setPagina] = useState(1)

  const cargar = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(
        `${PB_URL}/api/collections/solicitudes/records?sort=-created&perPage=500`
      )
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setSolicitudes(data.items ?? [])
      setLastFetch(new Date())
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al cargar")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void cargar() }, [])

  const maquinas = useMemo(
    () => [...new Set(solicitudes.map(s => s.impresora_nombre).filter(Boolean))].sort(),
    [solicitudes]
  )

  const filtradas = useMemo(() => {
    const inicio = inicioDelPeriodo(periodo)
    return solicitudes.filter(s => {
      if (inicio && new Date(s.created) < inicio) return false
      if (filtroMaquina !== "todas" && s.impresora_nombre !== filtroMaquina) return false
      if (filtroUrgencia !== "todas" && s.urgencia !== filtroUrgencia) return false
      if (filtroEstado === "completadas" && s.estado !== "entregado" && s.estado !== "depositado") return false
      if (filtroEstado !== "completadas" && filtroEstado !== "todas" && s.estado !== filtroEstado) return false
      if (busqueda) {
        const q = busqueda.toLowerCase()
        if (!s.color.toLowerCase().includes(q) && !s.impresora_nombre.toLowerCase().includes(q) && !s.serie_tinta.toLowerCase().includes(q)) return false
      }
      return true
    })
  }, [solicitudes, periodo, filtroMaquina, filtroUrgencia, filtroEstado, busqueda])

  // Stats (sobre el período filtrado sin filtros de estado/urgencia/búsqueda para que los totales sean globales del período)
  const base = useMemo(() => {
    const inicio = inicioDelPeriodo(periodo)
    return solicitudes.filter(s => {
      if (inicio && new Date(s.created) < inicio) return false
      if (filtroMaquina !== "todas" && s.impresora_nombre !== filtroMaquina) return false
      return true
    })
  }, [solicitudes, periodo, filtroMaquina])

  const stats = useMemo(() => {
    const completadas = base.filter(s => s.estado === "entregado" || s.estado === "depositado")
    const totalKg = completadas.reduce((sum, s) => sum + (s.kg_fabricados || s.kg_a_fabricar || 0), 0)
    const urgentes = base.filter(s => s.urgencia === "rojo").length
    const tiempos = completadas.map(tiempoFabricacion).filter((t): t is number => t !== null)
    const avgTiempo = tiempos.length > 0 ? Math.round(tiempos.reduce((a, b) => a + b, 0) / tiempos.length) : null
    return { total: base.length, completadas: completadas.length, totalKg, urgentes, avgTiempo }
  }, [base])

  const kgPorMaquina = useMemo(() => {
    const inicio = inicioDelPeriodo(periodo)
    const mapa: Record<string, number> = {}
    solicitudes.forEach(s => {
      if (inicio && new Date(s.created) < inicio) return
      if (s.estado !== "entregado" && s.estado !== "depositado") return
      const kg = s.kg_fabricados || s.kg_a_fabricar || 0
      mapa[s.impresora_nombre] = (mapa[s.impresora_nombre] || 0) + kg
    })
    return Object.entries(mapa)
      .map(([maquina, kg]) => ({ maquina: maquina.replace(/^I\d+-/, ""), kg: Math.round(kg * 10) / 10 }))
      .sort((a, b) => b.kg - a.kg)
  }, [solicitudes, periodo])

  // Paginación
  const totalPaginas = Math.max(1, Math.ceil(filtradas.length / PAGE_SIZE))
  const paginaActual = Math.min(pagina, totalPaginas)
  const registros = filtradas.slice((paginaActual - 1) * PAGE_SIZE, paginaActual * PAGE_SIZE)

  // Reset página al cambiar filtros
  useEffect(() => { setPagina(1) }, [periodo, filtroMaquina, filtroUrgencia, filtroEstado, busqueda])

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-foreground">Historial y Reportes</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Registro de solicitudes y estadísticas de consumo
            {lastFetch && (
              <span className="ml-2 text-[11px] text-muted-foreground/60">
                · actualizado {lastFetch.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })}
              </span>
            )}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void cargar()} disabled={loading}>
          <RefreshCw className={cn("h-3.5 w-3.5 mr-1.5", loading && "animate-spin")} />
          Actualizar
        </Button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-300 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-400">
          Error al cargar datos: {error}
        </div>
      )}

      {/* Período */}
      <div className="flex flex-wrap gap-2">
        {(["hoy", "7dias", "30dias", "todo"] as Periodo[]).map(p => (
          <Button
            key={p}
            size="sm"
            variant={periodo === p ? "default" : "outline"}
            onClick={() => setPeriodo(p)}
            className="h-8 text-xs"
          >
            {{ hoy: "Hoy", "7dias": "7 días", "30dias": "30 días", todo: "Todo" }[p]}
          </Button>
        ))}
      </div>

      {/* Stats */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2 pt-4 px-4">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Completadas</CardTitle>
            <ClipboardList className="h-4 w-4 text-muted-foreground/50" />
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <p className="text-3xl font-bold font-mono text-foreground leading-none">{stats.completadas}</p>
            <p className="text-xs text-muted-foreground mt-1">de {stats.total} solicitudes</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2 pt-4 px-4">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Total kg</CardTitle>
            <Droplets className="h-4 w-4 text-muted-foreground/50" />
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <p className="text-3xl font-bold font-mono text-foreground leading-none">
              {stats.totalKg.toLocaleString("es-MX", { maximumFractionDigits: 1 })}
            </p>
            <p className="text-xs text-muted-foreground mt-1">kilogramos fabricados</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2 pt-4 px-4">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Urgentes</CardTitle>
            <AlertTriangle className="h-4 w-4 text-muted-foreground/50" />
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <p className={cn("text-3xl font-bold font-mono leading-none", stats.urgentes > 0 ? "text-red-600 dark:text-red-400" : "text-foreground")}>
              {stats.urgentes}
            </p>
            <p className="text-xs text-muted-foreground mt-1">solicitudes en rojo</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2 pt-4 px-4">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">T. fabricación</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground/50" />
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <p className="text-3xl font-bold font-mono text-foreground leading-none">
              {stats.avgTiempo !== null ? stats.avgTiempo : "—"}
              {stats.avgTiempo !== null && <span className="text-base font-normal text-muted-foreground"> min</span>}
            </p>
            <p className="text-xs text-muted-foreground mt-1">promedio por solicitud</p>
          </CardContent>
        </Card>
      </div>

      {/* Chart */}
      {kgPorMaquina.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-foreground">Kg fabricados por prensa</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={kgPorMaquina} margin={{ top: 4, right: 8, bottom: 24, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="opacity-20" />
                  <XAxis dataKey="maquina" tick={{ fontSize: 10 }} angle={-25} textAnchor="end" height={48} />
                  <YAxis tick={{ fontSize: 10 }} width={36} />
                  <Tooltip
                    formatter={(v: number) => [`${v} kg`, "Fabricado"]}
                    contentStyle={{
                      borderRadius: "8px",
                      border: "1px solid hsl(var(--border))",
                      backgroundColor: "hsl(var(--card))",
                      color: "hsl(var(--foreground))",
                      fontSize: 12,
                    }}
                  />
                  <Bar dataKey="kg" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Filtros + Tabla */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Buscar color, prensa…"
            value={busqueda}
            onChange={e => setBusqueda(e.target.value)}
            className="pl-8 h-8 text-xs w-48"
          />
        </div>
        <Select value={filtroEstado} onValueChange={setFiltroEstado}>
          <SelectTrigger className="h-8 text-xs w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="completadas">Completadas</SelectItem>
            <SelectItem value="todas">Todos los estados</SelectItem>
            <SelectItem value="pendiente">En espera</SelectItem>
            <SelectItem value="fabricando">Fabricando</SelectItem>
            <SelectItem value="fabricado">Fabricado</SelectItem>
            <SelectItem value="entregado">Entregado</SelectItem>
            <SelectItem value="depositado">Depositado</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filtroMaquina} onValueChange={setFiltroMaquina}>
          <SelectTrigger className="h-8 text-xs w-44">
            <SelectValue placeholder="Prensa" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todas las prensas</SelectItem>
            {maquinas.map(m => (
              <SelectItem key={m} value={m}>{m}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filtroUrgencia} onValueChange={setFiltroUrgencia}>
          <SelectTrigger className="h-8 text-xs w-36">
            <SelectValue placeholder="Urgencia" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Toda urgencia</SelectItem>
            <SelectItem value="rojo">Urgente</SelectItem>
            <SelectItem value="naranja">Moderado</SelectItem>
            <SelectItem value="verde">Normal</SelectItem>
          </SelectContent>
        </Select>
        <span className="ml-auto text-xs text-muted-foreground">
          {filtradas.length} registro{filtradas.length !== 1 ? "s" : ""}
        </span>
      </div>

      <Card className="overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16 gap-3 text-muted-foreground">
            <LoaderCircle className="h-5 w-5 animate-spin text-primary/50" />
            <span className="text-sm">Cargando historial…</span>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground whitespace-nowrap">Fecha</th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Prensa</th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Color</th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground hidden md:table-cell">Serie</th>
                    <th className="px-4 py-2.5 text-right text-xs font-medium text-muted-foreground">Kg sol.</th>
                    <th className="px-4 py-2.5 text-right text-xs font-medium text-muted-foreground">Kg fab.</th>
                    <th className="px-4 py-2.5 text-right text-xs font-medium text-muted-foreground hidden sm:table-cell">T. estimado</th>
                    <th className="px-4 py-2.5 text-right text-xs font-medium text-muted-foreground hidden sm:table-cell">T. fabr.</th>
                    <th className="px-4 py-2.5 text-center text-xs font-medium text-muted-foreground">Urgencia</th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Estado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {registros.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="py-12 text-center text-sm text-muted-foreground">
                        Sin registros para los filtros seleccionados
                      </td>
                    </tr>
                  ) : (
                    registros.map(s => {
                      const tFabr = tiempoFabricacion(s)
                      const kgFab = s.kg_fabricados || s.kg_a_fabricar || 0
                      const exceso = kgFab - s.kg_a_fabricar
                      return (
                        <tr key={s.id} className="hover:bg-muted/20 transition-colors">
                          <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{formatFecha(s.created)}</td>
                          <td className="px-4 py-3 text-xs font-medium text-foreground">{s.impresora_nombre}</td>
                          <td className="px-4 py-3">
                            <p className="text-xs font-semibold text-foreground leading-tight">{s.color}</p>
                          </td>
                          <td className="px-4 py-3 text-[11px] text-muted-foreground hidden md:table-cell">{s.serie_tinta || "—"}</td>
                          <td className="px-4 py-3 text-right font-mono text-xs text-foreground">{s.kg_a_fabricar}</td>
                          <td className="px-4 py-3 text-right font-mono text-xs">
                            <span className={cn("font-bold", exceso > 0.5 ? "text-amber-600 dark:text-amber-400" : "text-foreground")}>
                              {kgFab > 0 ? kgFab : "—"}
                            </span>
                            {exceso > 0.5 && (
                              <span className="block text-[10px] text-amber-600 dark:text-amber-400">+{exceso.toFixed(1)}</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-xs text-muted-foreground hidden sm:table-cell">
                            {s.tiempo_estimado_min || "—"}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-xs text-muted-foreground hidden sm:table-cell">
                            {tFabr !== null ? tFabr : "—"}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span className={cn(
                              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold border",
                              s.urgencia === "rojo" && "bg-red-500/10 text-red-600 border-red-300 dark:text-red-400",
                              s.urgencia === "naranja" && "bg-amber-500/10 text-amber-600 border-amber-300 dark:text-amber-400",
                              s.urgencia === "verde" && "bg-emerald-500/10 text-emerald-600 border-emerald-300 dark:text-emerald-400",
                            )}>
                              {URGENCIA_LABEL[s.urgencia] ?? s.urgencia}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <span className={cn(
                              "inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-semibold",
                              ESTADO_CLASS[s.estado] ?? "bg-muted text-muted-foreground border-border"
                            )}>
                              {ESTADO_LABEL[s.estado] ?? s.estado}
                            </span>
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* Paginación */}
            {totalPaginas > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t">
                <span className="text-xs text-muted-foreground">
                  Página {paginaActual} de {totalPaginas}
                </span>
                <div className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => setPagina(p => Math.max(1, p - 1))}
                    disabled={paginaActual === 1}
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => setPagina(p => Math.min(totalPaginas, p + 1))}
                    disabled={paginaActual === totalPaginas}
                  >
                    <ChevronRight className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  )
}
