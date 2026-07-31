import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "react-router";

import type { Route } from "./+types/root";
import "./app.css";
import { Sidebar } from "./components/Sidebar";

export const links: Route.LinksFunction = () => [
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  {
    rel: "preconnect",
    href: "https://fonts.gstatic.com",
    crossOrigin: "anonymous",
  },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&display=swap",
  },
];

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr" className="h-full bg-slate-50 antialiased">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>TransitPanel - Toplu Taşıma Yonetim Paneli</title>
        <Meta />
        <Links />
      </head>
      <body className="h-full font-sans bg-slate-50 text-slate-900 m-0 p-0 overflow-hidden">
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-50">
      <Sidebar />
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden bg-slate-50">
        <Outlet />
      </main>
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let message = "Bir Hata Oluştu";
  let details = "Beklenmeyen bir sunucu veya istemci hatası meydana geldi.";
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? "404 - Sayfa Bulunamadı" : "Hata";
    details =
      error.status === 404
        ? "Aradığınız sayfa mevcut değil veya taşınmış olabilir."
        : error.statusText || details;
  } else if (import.meta.env.DEV && error && error instanceof Error) {
    details = error.message;
    stack = error.stack;
  }

  return (
    <div className="flex h-screen w-screen items-center justify-center p-6 bg-slate-50">
      <div className="max-w-md w-full bg-white p-6 rounded-2xl border border-slate-200 shadow-sm text-center">
        <div className="w-12 h-12 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto mb-4 font-bold text-lg">
          !
        </div>
        <h1 className="text-xl font-bold text-slate-900 mb-2">{message}</h1>
        <p className="text-sm text-slate-600 mb-4">{details}</p>
        {stack && (
          <pre className="text-left text-xs bg-slate-900 text-slate-100 p-3 rounded-lg overflow-x-auto max-h-48 mb-4">
            <code>{stack}</code>
          </pre>
        )}
        <a
          href="/"
          className="inline-block px-4 py-2 bg-blue-600 text-white rounded-lg font-medium text-sm hover:bg-blue-700 transition"
        >
          Anasayfaya Dön
        </a>
      </div>
    </div>
  );
}
