export type EstadoMaquina = "activa" | "parada" | "cambio"
export type SistemaTinta = "tradicional" | "colortrack"
export type EstadoSolicitud = "pendiente" | "fabricando" | "fabricado" | "entregado" | "depositado"
export type NivelUrgencia = "rojo" | "naranja" | "verde"

export interface Anilox {
  lineatura: number
  volumen: number
}

export interface CuerpoImpresor {
  numero: number
  color: string
  anilox: Anilox
  superficiePorcentaje: number
  serieTinta: string
  kgRestantes: number
}

export interface TrabajoActual {
  ordenProduccion: string
  producto: string
  printCard?: string
  metrosTotales: number
  metrosRestantes: number
  porcentaje: number
  velocidadActual: number
  anchoImpresion: number
}

export interface Impresora {
  id: string
  nombre: string
  estado: EstadoMaquina
  sistema: SistemaTinta
  trabajoActual: TrabajoActual | null
  cuerpos: CuerpoImpresor[]
  solicitudesPendientes: number
  tieneNotificacion: boolean
}

export interface SolicitudTinta {
  id: string
  timestamp: Date
  impresoraId: string
  impresoraNombre: string
  ordenProduccion?: string
  printCard?: string
  metrosCalculo?: number
  runKey?: string
  cuerpoNumero: number
  color: string
  serieTinta: string
  kgEnMaquina: number
  metrosRestantes: number
  superficiePorcentaje: number
  aniloxLineatura: number
  aniloxVolumen: number
  velocidadActual: number
  viscosidadActual: number
  anchoImpresion: number
  kgAFabricar: number
  tiempoEstimadoMin: number
  urgencia: NivelUrgencia
  estado: EstadoSolicitud
  kgFabricados?: number
  timestampFabricando?: Date
  timestampFabricado?: Date
  timestampEntregado?: Date
}

export interface Notificacion {
  id: string
  impresoraId: string
  impresoraNombre: string
  solicitudId: string
  color: string
  tipo: "fabricando" | "fabricado"
  mensaje: string
  timestamp: Date
  leida: boolean
}

export interface RegistroHistorial {
  id: string
  fechaSolicitud: Date
  fechaCompletado: Date
  impresoraNombre: string
  color: string
  serieTinta: string
  kgSolicitados: number
  kgFabricados: number
  tiempoUrgenciaOriginal: number
  tiempoRealFabricacion: number
  estado: "completado" | "retorno_parcial"
}

export function calcularKgNecesarios(
  metrosRestantes: number,
  superficiePorcentaje: number,
  aniloxVolumen: number,
  anchoImpresion: number,
  kgEnMaquina: number
): number {
  const consumoPorMetro = (superficiePorcentaje / 100) * (aniloxVolumen / 1000) * anchoImpresion
  const kgNecesarios = Math.max(0, metrosRestantes * consumoPorMetro - kgEnMaquina)
  return Math.round(kgNecesarios * 10) / 10
}

export function calcularTiempoMinutos(metrosRestantes: number, velocidadActual: number): number {
  if (velocidadActual <= 0) return 999
  return Math.round(metrosRestantes / velocidadActual)
}

export function determinarUrgencia(tiempoMinutos: number): NivelUrgencia {
  if (tiempoMinutos <= 30) return "rojo"
  if (tiempoMinutos <= 40) return "naranja"
  return "verde"
}

export function getUrgenciaLabel(urgencia: NivelUrgencia): string {
  switch (urgencia) {
    case "rojo":
      return "Urgente"
    case "naranja":
      return "Moderado"
    case "verde":
      return "Normal"
  }
}

export function getEstadoLabel(estado: EstadoSolicitud): string {
  switch (estado) {
    case "pendiente":
      return "En Espera"
    case "fabricando":
      return "Fabricando"
    case "fabricado":
      return "Fabricado"
    case "entregado":
      return "Entregado"
    case "depositado":
      return "Depositado"
  }
}
