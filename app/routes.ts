import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/dashboard.tsx"),
  route("map", "routes/map.tsx"),
  route("sync", "routes/sync.tsx"),
  route("data", "routes/data.tsx"),
  route("import", "routes/import.tsx"),
  route("export", "routes/export.tsx"),
  route("settings", "routes/settings.tsx"),
  route("api/export-zip", "routes/api.export-zip.ts"),
  route("api/import-stream", "routes/api.import-stream.ts"),
  route("api/valhalla", "routes/api.valhalla.ts"),
  route("api/route-details", "routes/api.route-details.ts"),
  route("api/save-route", "routes/api.save-route.ts"),
] satisfies RouteConfig;
