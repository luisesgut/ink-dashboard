"use client"

import { usePathname } from "next/navigation"
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/app-sidebar"
import { AppHeader } from "@/components/app-header"

export function ClientLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const shouldHideSidebar =
    pathname.startsWith("/maquina/") ||
    pathname === "/cocina" ||
    pathname === "/devoluciones"

  if (shouldHideSidebar) {
    return (
      <div className="flex min-h-svh flex-col w-full">
        <AppHeader showSidebarTrigger={false} />
        <div className="flex-1 p-4 lg:p-6">{children}</div>
      </div>
    )
  }

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <AppHeader />
        <div className="p-4 lg:p-6">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  )
}
