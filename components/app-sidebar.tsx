"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  LayoutDashboard,
  FlaskConical,
  Bell,
  ClipboardList,
  Droplets,
} from "lucide-react"
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarFooter,
  SidebarSeparator,
} from "@/components/ui/sidebar"
import { useInkStore } from "@/lib/store"

const navItems = [
  { label: "Dashboard", href: "/", icon: LayoutDashboard },
  { label: "Cocina de Tintas", href: "/cocina", icon: FlaskConical },
  { label: "Notificaciones", href: "/notificaciones", icon: Bell },
  { label: "Historial", href: "/historial", icon: ClipboardList },
]

export function AppSidebar() {
  const pathname = usePathname()
  const { getNotificacionesSinLeer } = useInkStore()
  const sinLeer = getNotificacionesSinLeer()

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="p-4">
        <Link href="/" className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sidebar-primary">
            <Droplets className="h-4 w-4 text-sidebar-primary-foreground" />
          </div>
          <div className="flex flex-col group-data-[collapsible=icon]:hidden">
            <span className="text-sm font-bold text-sidebar-foreground">InkBFX</span>
            <span className="text-[10px] text-sidebar-foreground/60">
              Sistema de Tintas
            </span>
          </div>
        </Link>
      </SidebarHeader>

      <SidebarSeparator />

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navegacion</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
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
                    >
                      <Link href={item.href}>
                        <item.icon className="h-4 w-4" />
                        <span>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                    {badgeCount > 0 && (
                      <SidebarMenuBadge className="bg-urgency-red text-white text-[10px] rounded-full min-w-5 h-5 flex items-center justify-center">
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

      <SidebarFooter className="p-4 group-data-[collapsible=icon]:p-2">
        <div className="flex items-center gap-2 group-data-[collapsible=icon]:justify-center">
          <div className="h-2 w-2 rounded-full bg-urgency-green" />
          <span className="text-[10px] text-sidebar-foreground/60 group-data-[collapsible=icon]:hidden">
            Sistema activo
          </span>
        </div>
      </SidebarFooter>
    </Sidebar>
  )
}
