import { ReactNode, useState } from "react";
import { NavLink, useLocation, Link } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import {
  LayoutDashboard,
  ArrowLeftRight,
  Package,
  Users,
  BarChart3,
  LogOut,
  Shield,
  Menu,
  History,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import logoImage from "@/assets/MLogo.png";

const navItems = [
  { to: "/", label: "Табло", icon: LayoutDashboard, roles: ["admin", "user"] },
  { to: "/movements", label: "Отдаване/Приемане", icon: ArrowLeftRight, roles: ["admin", "user"] },
  { to: "/history", label: "История", icon: History, roles: ["admin", "user"] },
  { to: "/inventory", label: "Инвентар", icon: Package, roles: ["admin", "user"] },
  { to: "/employees", label: "Служители", icon: Users, roles: ["admin"] },
  { to: "/users", label: "Потребители", icon: Shield, roles: ["admin"] },
  { to: "/reports", label: "Справки", icon: BarChart3, roles: ["admin"] },
];

function SidebarContent({
  role,
  user,
  signOut,
  onNavClick,
}: {
  role: string | null;
  user: { email?: string } | null;
  signOut: () => void;
  onNavClick?: () => void;
}) {
  const location = useLocation();
  const clearLocalSession = () => {
    localStorage.removeItem("tk_role");
    Object.keys(localStorage).forEach((key) => {
      if (key.startsWith("sb-") && key.endsWith("-auth-token")) {
        localStorage.removeItem(key);
      }
    });
    window.location.href = "/login";
  };

  return (
    <>
      <div className="p-5 border-b border-sidebar-border">
        <Link to="/" className="flex items-center justify-center">
          <img src={logoImage} alt="Склад" className="h-12 w-auto" />
        </Link>
      </div>

      <nav className="flex-1 p-3 space-y-1">
        {navItems
          .filter((item) => item.roles.includes(role || "user"))
          .map((item) => {
            const isActive = location.pathname === item.to;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={onNavClick}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all",
                  isActive
                    ? "bg-sidebar-accent text-primary"
                    : "text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground",
                )}
              >
                <item.icon className="w-4 h-4" />
                {item.label}
              </NavLink>
            );
          })}
      </nav>

      <div className="p-3 border-t border-sidebar-border space-y-2">
        <div className="flex items-center gap-2 px-3 py-2">
          <div className="flex items-center gap-1.5">
            <Shield className="w-3.5 h-3.5 text-primary" />
            <span className="text-xs font-medium text-muted-foreground capitalize">
              {role === "admin" ? "Администратор" : "Потребител"}
            </span>
          </div>
        </div>
        <p className="text-xs text-muted-foreground px-3 truncate">{user?.email}</p>
        <Button
          variant="ghost"
          size="sm"
          onClick={signOut}
          className="w-full justify-start text-muted-foreground hover:text-destructive"
        >
          <LogOut className="w-4 h-4 mr-2" />
          Изход
        </Button>
        {import.meta.env.DEV && (
          <Button
            variant="ghost"
            size="sm"
            onClick={clearLocalSession}
            className="w-full justify-start text-muted-foreground"
          >
            Изчисти локална сесия
          </Button>
        )}
      </div>
    </>
  );
}

export default function AppLayout({ children }: { children: ReactNode }) {
  const { signOut, role, user } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="min-h-screen flex bg-background">
      <aside className="hidden md:flex w-64 bg-sidebar border-r border-sidebar-border flex-col shrink-0">
        <SidebarContent role={role} user={user} signOut={signOut} />
      </aside>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-64 p-0 bg-sidebar">
          <SheetTitle className="sr-only">Навигация</SheetTitle>
          <div className="flex flex-col h-full">
            <SidebarContent role={role} user={user} signOut={signOut} onNavClick={() => setMobileOpen(false)} />
          </div>
        </SheetContent>
      </Sheet>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="md:hidden flex items-center gap-3 p-4 border-b border-border bg-background">
          <Button variant="ghost" size="sm" onClick={() => setMobileOpen(true)}>
            <Menu className="w-5 h-5" />
          </Button>
          <Link to="/" className="flex items-center">
            <img src={logoImage} alt="Склад" className="h-8 w-auto" />
          </Link>
        </header>

        <main className="flex-1 overflow-auto custom-scrollbar">
          <div className="p-4 md:p-6 max-w-7xl mx-auto animate-fade-in">{children}</div>
        </main>
      </div>
    </div>
  );
}
