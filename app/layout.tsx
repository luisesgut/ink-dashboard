import type { Metadata } from 'next'
import type { Viewport } from 'next'

import './globals.css'
import { ClientLayout } from '@/components/client-layout'
import { InkProvider } from '@/lib/store'
import { Toaster } from '@/components/ui/sonner'

export const metadata: Metadata = {
  title: 'InkBFX - Sistema de Solicitud y Suministro de Tinta',
  description: 'Sistema de gestion de solicitudes y suministro de tinta para impresoras industriales flexograficas',
}

export const viewport: Viewport = {
  themeColor: '#1e293b',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="es">
      <body className="font-sans antialiased">
        <InkProvider>
          <ClientLayout>
            {children}
          </ClientLayout>
          <Toaster />
        </InkProvider>
      </body>
    </html>
  )
}
