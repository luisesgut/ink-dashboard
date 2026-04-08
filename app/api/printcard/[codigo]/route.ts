import { NextRequest, NextResponse } from "next/server"

const PC_BASE = "http://172.16.10.31/api/Printcard"

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ codigo: string }> }
) {
  const { codigo } = await params
  if (!codigo) return new NextResponse("Missing codigo", { status: 400 })

  try {
    const upstream = await fetch(`${PC_BASE}/${encodeURIComponent(codigo)}`, {
      headers: { Accept: "text/html,application/xhtml+xml,*/*" },
    })

    const contentType = upstream.headers.get("content-type") ?? "text/html"
    const body = await upstream.arrayBuffer()

    return new NextResponse(body, {
      status: upstream.status,
      headers: {
        "Content-Type": contentType,
        // Eliminar headers que bloquean el iframe
        "X-Frame-Options": "SAMEORIGIN",
        "Content-Security-Policy": "frame-ancestors 'self'",
      },
    })
  } catch {
    return new NextResponse("Error al obtener el Print Card", { status: 502 })
  }
}
