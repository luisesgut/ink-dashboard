"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  LayoutDashboard,
  FlaskConical,
  Bell,
  ClipboardList,
  Droplets,
  Undo2,
} from "lucide-react"
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarFooter,
  SidebarHeader,
} from "@/components/ui/sidebar"
import { useInkStore } from "@/lib/store"
import { cn } from "@/lib/utils"

const navItems = [
  { label: "Dashboard", href: "/", icon: LayoutDashboard },
  { label: "Cocina de Tintas", href: "/cocina", icon: FlaskConical },
  { label: "Devoluciones", href: "/devoluciones", icon: Undo2 },
  { label: "Notificaciones", href: "/notificaciones", icon: Bell },
  { label: "Historial", href: "/historial", icon: ClipboardList },
]

export function AppSidebar() {
  const pathname = usePathname()
  const { getNotificacionesSinLeer } = useInkStore()
  const sinLeer = getNotificacionesSinLeer()

  return (
    <Sidebar collapsible="icon">
      {/* Brand */}
      <SidebarHeader className="px-3 py-4">
        <Link href="/" className="flex items-center gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-sidebar-accent/50">
          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-sidebar-primary shadow-sm">
            <Droplets className="h-4 w-4 text-sidebar-primary-foreground" />
          </div>
          <div className="flex flex-col leading-none group-data-[collapsible=icon]:hidden">
            <span className="text-sm font-bold tracking-tight text-sidebar-foreground">
              InkBFX
            </span>
            <span className="text-[10px] text-sidebar-foreground/50 mt-0.5">
              Control de Tintas
            </span>
          </div>
        </Link>
      </SidebarHeader>

      {/* Divider */}
      <div className="mx-3 h-px bg-sidebar-border/50" />

      {/* Nav */}
      <SidebarContent className="px-2 py-3">
        <SidebarGroup className="p-0">
          <SidebarGroupContent>
            <SidebarMenu className="gap-0.5">
              {navItems.map((item) => {
                const isActive =
                  item.href === "/"
                    ? pathname === "/"
                    : pathname.startsWith(item.href)

                const badgeCount =
                  item.href === "/notificaciones" ? sinLeer : 0

                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      asChild
                      isActive={isActive}
                      tooltip={item.label}
                      className={cn(
                        "h-9 rounded-lg px-3 text-sm font-medium transition-all duration-150",
                        "text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/60",
                        isActive && [
                          "bg-sidebar-primary/15 text-sidebar-primary-foreground",
                          "hover:bg-sidebar-primary/20",
                        ]
                      )}
                    >
                      <Link href={item.href} className="flex items-center gap-3">
                        <item.icon className={cn(
                          "h-4 w-4 flex-shrink-0 transition-colors",
                          isActive ? "text-sidebar-primary" : "text-sidebar-foreground/50"
                        )} />
                        <span className="group-data-[collapsible=icon]:hidden">{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                    {badgeCount > 0 && (
                      <SidebarMenuBadge className="bg-urgency-red text-white text-[9px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center">
                        {badgeCount}
                      </SidebarMenuBadge>
                    )}
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      {/* Footer */}
      <div className="mx-3 h-px bg-sidebar-border/50" />
      <SidebarFooter className="px-3 py-3">
        <div className="flex items-center gap-2.5 px-2 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
          <span className="relative flex h-2 w-2 flex-shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-urgency-green opacity-50" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-urgency-green" />
          </span>
          <span className="text-[11px] text-sidebar-foreground/40 group-data-[collapsible=icon]:hidden">
            En línea
          </span>
        </div>
      </SidebarFooter>
    </Sidebar>
  )
}
