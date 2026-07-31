import { Link, useLocation } from "react-router";
import {
  LayoutDashboard,
  Map,
  Route as RouteIcon,
  Database,
  UploadCloud,
  DownloadCloud,
  Settings,
  Bus,
  ChevronRight,
  Menu,
  X,
} from "lucide-react";
import { useState } from "react";

export function Sidebar() {
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  const navigation = [
    { name: "Dashboard", href: "/", icon: LayoutDashboard },
    { name: "Harita", href: "/map", icon: Map },
    { name: "Rota Düzenle", href: "/sync", icon: RouteIcon },
    { name: "Veri Yönetimi", href: "/data", icon: Database },
    { name: "Import (JSON Yükle)", href: "/import", icon: UploadCloud },
    { name: "Export (Zip İndir)", href: "/export", icon: DownloadCloud },
    { name: "Ayarlar", href: "/settings", icon: Settings },
  ];

  const isActive = (path: string) => {
    if (path === "/") return location.pathname === "/";
    return location.pathname.startsWith(path);
  };

  return (
    <>
      {/* Mobile menu toggle */}
      <div className="lg:hidden fixed top-3 left-3 z-50">
        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          className="p-2 rounded-lg bg-white shadow-md border border-slate-200 text-slate-700 hover:bg-slate-50 transition"
        >
          {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {/* Backdrop for mobile */}
      {mobileOpen && (
        <div
          onClick={() => setMobileOpen(false)}
          className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs z-40 lg:hidden"
        />
      )}

      {/* Sidebar container */}
      <aside
        className={`fixed lg:static inset-y-0 left-0 z-40 w-64 bg-white border-r border-slate-200 flex flex-col justify-between transform transition-transform duration-200 ease-in-out ${
          mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        }`}
      >
        <div className="flex flex-col h-full">
          {/* Header / Logo */}
          <div className="h-16 px-6 border-b border-slate-100 flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center text-white shadow-sm shadow-blue-500/20">
              <Bus className="w-5 h-5" />
            </div>
            <div>
              <h1 className="font-bold text-slate-900 text-lg leading-none tracking-tight">
                TransitPanel
              </h1>
              <span className="text-xs text-slate-500 font-medium">GTFS & PostGIS Admin</span>
            </div>
          </div>

          {/* Navigation Items */}
          <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
            {navigation.map((item) => {
              const active = isActive(item.href);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  to={item.href}
                  onClick={() => setMobileOpen(false)}
                  className={`group flex items-center justify-between px-3.5 py-2.5 rounded-lg text-sm font-medium transition-all ${
                    active
                      ? "bg-blue-50 text-blue-700 shadow-xs font-semibold"
                      : "text-slate-600 hover:bg-slate-100/80 hover:text-slate-900"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <Icon
                      className={`w-4 h-4 transition-colors ${
                        active ? "text-blue-600" : "text-slate-400 group-hover:text-slate-600"
                      }`}
                    />
                    <span>{item.name}</span>
                  </div>
                  {active && <ChevronRight className="w-4 h-4 text-blue-600" />}
                </Link>
              );
            })}
          </nav>

          {/* Footer Info */}
          <div className="p-4 border-t border-slate-100 bg-slate-50/50">
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span>PostGIS 16-3.4 Bağlı</span>
            </div>
            <p className="text-[11px] text-slate-400 mt-1">v2.0 • TransitJSON Engine</p>
          </div>
        </div>
      </aside>
    </>
  );
}
