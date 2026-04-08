"use client"

import { useEffect, useMemo, useState } from "react"
import { useInkStore } from "@/lib/store"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts"
import {
  ClipboardList,
  Clock,
  AlertTriangle,
  RotateCcw,
  Filter,
} from "lucide-react"

function formatFecha(date: Date): string {
  return date.toLocaleString("es-MX", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
}

export default function HistorialPage() {
  const { historial, impresoras } = useInkStore()
  const [filtroMaquina, setFiltroMaquina] = useState<string>("todas")
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  const historialFiltrado =
    filtroMaquina === "todas"
      ? historial
      : historial.filter((h) => h.impresoraNombre === filtroMaquina)

  const totalSolicitudes = historial.length
  const tiempoPromedio =
    historial.length > 0
      ? Math.round(
          historial.reduce((sum, h) => sum + h.tiempoRealFabricacion, 0) /
            historial.length
        )
      : 0
  const retornos = historial.filter((h) => h.estado === "retorno_parcial").length
  const solicitudesUrgentes = historial.filter(
    (h) => h.tiempoUrgenciaOriginal <= 30
  ).length
  const maquinasFiltro = useMemo(() => {
    if (impresoras.length > 0) {
      return impresoras.map((imp) => imp.nombre)
    }
    return [...new Set(historial.map((h) => h.impresoraNombre))].sort()
  }, [historial, impresoras])
  const consumoPorMaquina = useMemo(
    () =>
      maquinasFiltro.map((maquina) => ({
        maquina,
        kg: Math.round(
          historial
            .filter((h) => h.impresoraNombre === maquina)
            .reduce((sum, h) => sum + h.kgFabricados, 0) * 10
        ) / 10,
      })),
    [historial, maquinasFiltro]
  )
  const tiemposRespuesta = useMemo(() => {
    return historial
      .map((h) => ({
        hora: mounted
          ? h.fechaCompletado.toLocaleTimeString("es-MX", {
              hour: "2-digit",
              minute: "2-digit",
            })
          : "--",
        minutos: h.tiempoRealFabricacion,
      }))
      .sort((a, b) => a.hora.localeCompare(b.hora))
  }, [historial, mounted])

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-2xl font-bold text-foreground">
          Historial y Reportes
        </h2>
        <p className="text-sm text-muted-foreground">
          Registro de solicitudes completadas y estadisticas de consumo
        </p>
      </div>

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Solicitudes
            </CardTitle>
            <ClipboardList className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold font-mono text-foreground">
              {totalSolicitudes}
            </div>
            <p className="text-xs text-muted-foreground">en el turno actual</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Tiempo Promedio
            </CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold font-mono text-foreground">
              {tiempoPromedio}
              <span className="text-base font-normal text-muted-foreground">
                min
              </span>
            </div>
            <p className="text-xs text-muted-foreground">de fabricacion</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Retornos
            </CardTitle>
            <RotateCcw className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold font-mono text-urgency-orange">
              {retornos}
            </div>
            <p className="text-xs text-muted-foreground">
              fabricaron mas de lo necesario
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Urgentes
            </CardTitle>
            <AlertTriangle className="h-4 w-4 text-urgency-red" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold font-mono text-urgency-red">
              {solicitudesUrgentes}
            </div>
            <p className="text-xs text-muted-foreground">
              {"menos de 30 min"}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base text-foreground">
              Consumo de Tinta por Maquina (kg)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={consumoPorMaquina}>
                  <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                  <XAxis
                    dataKey="maquina"
                    tick={{ fontSize: 11 }}
                    angle={-30}
                    textAnchor="end"
                    height={60}
                  />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip
                    contentStyle={{
                      borderRadius: "8px",
                      border: "1px solid hsl(var(--border))",
                      backgroundColor: "hsl(var(--card))",
                      color: "hsl(var(--foreground))",
                    }}
                  />
                  <Bar
                    dataKey="kg"
                    fill="hsl(var(--primary))"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base text-foreground">
              Tiempos de Respuesta Cocina (min)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={tiemposRespuesta}>
                  <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                  <XAxis dataKey="hora" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip
                    contentStyle={{
                      borderRadius: "8px",
                      border: "1px solid hsl(var(--border))",
                      backgroundColor: "hsl(var(--card))",
                      color: "hsl(var(--foreground))",
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="minutos"
                    stroke="hsl(var(--primary))"
                    strokeWidth={2}
                    dot={{ fill: "hsl(var(--primary))" }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filter + Table */}
      <div className="flex items-center gap-2">
        <Filter className="h-4 w-4 text-muted-foreground" />
        <Select value={filtroMaquina} onValueChange={setFiltroMaquina}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Filtrar por maquina" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todas las maquinas</SelectItem>
            {maquinasFiltro.map((maquina) => (
              <SelectItem key={maquina} value={maquina}>
                {maquina}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base text-foreground">
            Registro Detallado
          </CardTitle>
        </CardHeader>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha/Hora</TableHead>
                <TableHead>Maquina</TableHead>
                <TableHead>Color</TableHead>
                <TableHead>Serie</TableHead>
                <TableHead className="text-right">Kg Solicitados</TableHead>
                <TableHead className="text-right">Kg Fabricados</TableHead>
                <TableHead className="text-right">Urgencia (min)</TableHead>
                <TableHead className="text-right">
                  Tiempo Real (min)
                </TableHead>
                <TableHead>Estado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {historialFiltrado.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                    Sin registros en el historial
                  </TableCell>
                </TableRow>
              ) : (
                historialFiltrado.map((reg) => {
                  const diff = reg.kgFabricados - reg.kgSolicitados
                  const hayRetorno = diff > 0.5
                  return (
                    <TableRow key={reg.id}>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {mounted ? formatFecha(reg.fechaSolicitud) : "--"}
                      </TableCell>
                      <TableCell className="font-medium text-foreground">
                        {reg.impresoraNombre}
                      </TableCell>
                      <TableCell className="text-foreground">{reg.color}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {reg.serieTinta}
                      </TableCell>
                      <TableCell className="text-right font-mono text-foreground">
                        {reg.kgSolicitados}
                      </TableCell>
                      <TableCell
                        className={`text-right font-mono font-bold ${
                          hayRetorno ? "text-urgency-orange" : "text-foreground"
                        }`}
                      >
                        {reg.kgFabricados}
                        {hayRetorno && (
                          <span className="ml-1 text-[10px]">
                            (+{diff.toFixed(1)})
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono text-foreground">
                        {reg.tiempoUrgenciaOriginal}
                      </TableCell>
                      <TableCell className="text-right font-mono text-foreground">
                        {reg.tiempoRealFabricacion}
                      </TableCell>
                      <TableCell>
                        {reg.estado === "completado" ? (
                          <Badge
                            variant="outline"
                            className="bg-emerald-50 text-emerald-700 border-emerald-300 text-[10px]"
                          >
                            Completado
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className="bg-amber-50 text-amber-700 border-amber-300 text-[10px]"
                          >
                            Retorno
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  )
}
