import { useLoaderData, useSearchParams, useNavigate, useNavigation } from "react-router";
import { useEffect, useRef, useState, useCallback } from "react";
import { getCountriesAndCities, getRoutesForCity, getMapRouteDetails } from "../lib/db-operations.server";
import { formatName } from "../lib/types";
import {
  MapPin,
  Bus,
  Clock,
  Navigation,
  Info,
  ChevronRight,
  Filter,
  Check,
  Search,
  ListOrdered,
  Loader2,
  RotateCw,
  Calendar,
  Focus,
} from "lucide-react";

export async function loader({ request }: { request: Request }) {
  const url = new URL(request.url);
  const selectedCityId = url.searchParams.get("city") || "";
  const selectedRouteId = url.searchParams.get("route") || "";

  // When both city and route are known, run all queries in parallel
  if (selectedCityId && selectedRouteId) {
    const [cities, routes, routeDetails] = await Promise.all([
      getCountriesAndCities(),
      getRoutesForCity(selectedCityId),
      getMapRouteDetails(selectedRouteId),
    ]);

    const activeCityObj = cities.find((c: any) => c.city_id === selectedCityId) || null;

    return {
      cities,
      routes,
      activeCityId: selectedCityId,
      activeRouteId: selectedRouteId,
      activeCityObj,
      routeDetails,
    };
  }

  // Otherwise, resolve IDs sequentially as needed
  const cities = await getCountriesAndCities();
  const activeCityId = selectedCityId || (cities.length > 0 ? cities[0].city_id : "");

  let routes: any[] = [];
  let routeDetails = null;

  if (activeCityId) {
    routes = await getRoutesForCity(activeCityId);
    const activeRouteId = selectedRouteId || (routes.length > 0 ? routes[0].route_id : "");
    if (activeRouteId) {
      routeDetails = await getMapRouteDetails(activeRouteId);
    }

    const activeCityObj = cities.find((c: any) => c.city_id === activeCityId) || null;

    return {
      cities,
      routes,
      activeCityId,
      activeRouteId,
      activeCityObj,
      routeDetails,
    };
  }

  return {
    cities,
    routes: [],
    activeCityId: "",
    activeRouteId: "",
    activeCityObj: null,
    routeDetails: null,
  };
}

const weekDaysList = [
  { id: "all", label: "Tümü" },
  { id: "monday", label: "Pzt" },
  { id: "tuesday", label: "Sal" },
  { id: "wednesday", label: "Çar" },
  { id: "thursday", label: "Per" },
  { id: "friday", label: "Cum" },
  { id: "saturday", label: "Cmt" },
  { id: "sunday", label: "Paz" },
];

const dayFullNames: Record<string, string> = {
  monday: "Pazartesi",
  tuesday: "Salı",
  wednesday: "Çarşamba",
  thursday: "Perşembe",
  friday: "Cuma",
  saturday: "Cumartesi",
  sunday: "Pazar",
};

export default function MapPage() {
  const { cities, routes, activeCityId, activeRouteId, activeCityObj, routeDetails } =
    useLoaderData<typeof loader>();
  
  const [searchParams, setSearchParams] = useSearchParams();
  const navigation = useNavigation();
  const isLoading = navigation.state === "loading";

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const leafletRef = useRef<any>(null);
  const layerGroupRef = useRef<any>(null);
  const lastFittedKeyRef = useRef<string>("");
  
  const [selectedDirection, setSelectedDirection] = useState<number>(1);
  const [selectedStop, setSelectedStop] = useState<any>(null);
  const [showTimetable, setShowTimetable] = useState<boolean>(false);
  const [routeSearchText, setRouteSearchText] = useState<string>("");
  const [selectedDay, setSelectedDay] = useState<string>("all");

  const activeRoute = routeDetails?.route || null;
  const isLoopRoute = activeRoute?.route_pattern === "loop";
  const effectiveDirection = isLoopRoute ? 0 : (selectedDirection === 0 ? 1 : selectedDirection);

  // Handle city selection change
  const handleCityChange = (cityId: string) => {
    setSelectedStop(null);
    setSearchParams({ city: cityId });
  };

  // Handle route selection change
  const handleRouteChange = (routeId: string) => {
    setSelectedStop(null);
    setSearchParams({ city: activeCityId, route: routeId });
  };

  // Render shapes and stops on Leaflet map
  const renderLeafletLayers = useCallback(() => {
    const map = mapInstanceRef.current;
    const L = leafletRef.current;
    if (!map || !L || !routeDetails) return;

    if (layerGroupRef.current) {
      layerGroupRef.current.clearLayers();
    } else {
      layerGroupRef.current = L.layerGroup().addTo(map);
    }

    const layerGroup = layerGroupRef.current;
    const { route, shapes, stops } = routeDetails;
    const routeColor = "#dc2626"; // Kırmızı rota çizgisi
    const stopColor = "#2563eb";  // Mavi duraklar

    const isLoop = route.route_pattern === "loop";
    const targetDir = isLoop ? 0 : (selectedDirection === 0 ? 1 : selectedDirection);

    // Filter shape and stops with robust fallback
    let shape = shapes.find((s: any) => Number(s.direction) === targetDir);
    if (!shape && shapes.length > 0) shape = shapes[0];

    let filteredStops = stops.filter((s: any) => Number(s.direction) === targetDir);
    if (filteredStops.length === 0 && stops.length > 0) filteredStops = stops;

    let hasBounds = false;
    let boundsGroup = L.featureGroup();

    // 1. Draw Route Polyline Shape (Kırmızı)
    if (shape && shape.coordinates && Array.isArray(shape.coordinates) && shape.coordinates.length > 0) {
      const latLons = shape.coordinates
        .filter((c: any) => c && c.lat != null && c.lon != null)
        .map((c: any) => [Number(c.lat), Number(c.lon)]);

      if (latLons.length > 0) {
        // Outer white casing line
        L.polyline(latLons, {
          color: "#ffffff",
          weight: 9,
          opacity: 0.9,
          lineCap: "round",
          lineJoin: "round",
        }).addTo(layerGroup);

        // Main RED route line
        const line = L.polyline(latLons, {
          color: routeColor,
          weight: 5,
          opacity: 1,
          lineCap: "round",
          lineJoin: "round",
        }).addTo(layerGroup);

        line.addTo(boundsGroup);
        hasBounds = true;
      }
    }

    // 2. Draw Stop Circle Markers (Mavi)
    filteredStops.forEach((stop: any) => {
      if (stop.lat == null || stop.lon == null) return;
      const lat = Number(stop.lat);
      const lon = Number(stop.lon);

      const marker = L.circleMarker([lat, lon], {
        radius: 7,
        fillColor: stopColor,
        color: "#ffffff",
        weight: 2,
        fillOpacity: 1,
      }).addTo(layerGroup);

      marker.bindTooltip(`<b>#${stop.sequence} - ${formatName(stop.stop_name)}</b>`, {
        permanent: false,
        direction: "top",
      });

      marker.on("click", () => {
        setSelectedStop(stop);
      });

      marker.addTo(boundsGroup);
      hasBounds = true;
    });

    // 3. Fit Map View to Bounds ONLY when city, route, or direction changes
    const currentKey = `${activeCityId}_${activeRouteId}_${targetDir}`;
    if (lastFittedKeyRef.current !== currentKey && hasBounds) {
      const bounds = boundsGroup.getBounds();
      if (bounds.isValid()) {
        map.fitBounds(bounds, { padding: [50, 50] });
        lastFittedKeyRef.current = currentKey;
      }
    }
  }, [routeDetails, selectedDirection, activeCityId, activeRouteId]);

  // Recenter map manually
  const handleRecenterMap = () => {
    const map = mapInstanceRef.current;
    const L = leafletRef.current;
    if (!map || !L || !layerGroupRef.current) return;

    const layers = layerGroupRef.current.getLayers();
    if (layers.length > 0) {
      const boundsGroup = L.featureGroup(layers);
      const bounds = boundsGroup.getBounds();
      if (bounds.isValid()) {
        map.fitBounds(bounds, { padding: [50, 50] });
      }
    }
  };

  // Initialize Leaflet Map
  useEffect(() => {
    if (!mapContainerRef.current) return;

    let map: any;

    import("leaflet").then((module) => {
      const L = module.default;
      leafletRef.current = L;

      // Fix Leaflet default marker icons
      delete (L.Icon.Default.prototype as any)._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png",
        iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png",
        shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png",
      });

      const centerLat = activeCityObj ? Number(activeCityObj.lat) : 40.19;
      const centerLon = activeCityObj ? Number(activeCityObj.lon) : 29.06;
      const defaultZoom = activeCityObj?.default_zoom || 12;

      // Clean up previous map instance if exists
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }

      map = L.map(mapContainerRef.current!, {
        center: [centerLat, centerLon],
        zoom: defaultZoom,
        zoomControl: true,
      });

      // Standard High-Detail OpenStreetMap Tiles
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).addTo(map);

      mapInstanceRef.current = map;
      layerGroupRef.current = L.layerGroup().addTo(map);

      setTimeout(() => {
        if (map) map.invalidateSize();
      }, 150);

      renderLeafletLayers();
    });

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, [activeCityId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-render layers when routeDetails or direction changes
  useEffect(() => {
    renderLeafletLayers();
  }, [renderLeafletLayers]);

  const filteredRoutesList = routes.filter((r) =>
    routeSearchText
      ? formatName(r.name).toLowerCase().includes(routeSearchText.toLowerCase()) ||
        (r.code && r.code.toLowerCase().includes(routeSearchText.toLowerCase())) ||
        (r.slug && r.slug.toLowerCase().includes(routeSearchText.toLowerCase()))
      : true
  );

  const activeRouteObj = routeDetails?.route || null;
  const currentStops = routeDetails?.stops.filter((s: any) => Number(s.direction) === effectiveDirection) || [];
  
  // All trips for current effective direction
  const rawTrips = routeDetails?.trips.filter((t: any) => Number(t.direction) === effectiveDirection) || [];

  // Filter trips for selected stop or first stop
  const filterStopId = selectedStop ? selectedStop.stop_id : null;
  const filteredTrips = rawTrips.filter((t: any) => {
    if (filterStopId) {
      return t.stop_id === filterStopId;
    }
    return Number(t.sequence) === 1; // Default to initial route departures
  });

  // Group trips by service_type (day of week)
  const tripsByDay: Record<string, any[]> = {
    monday: [],
    tuesday: [],
    wednesday: [],
    thursday: [],
    friday: [],
    saturday: [],
    sunday: [],
  };

  filteredTrips.forEach((t: any) => {
    const day = (t.service_type || "monday").toLowerCase();
    if (tripsByDay[day]) {
      tripsByDay[day].push(t);
    } else {
      tripsByDay.monday.push(t);
    }
  });

  const displayDays = selectedDay === "all"
    ? Object.keys(tripsByDay)
    : [selectedDay];

  return (
    <div className="flex-1 flex flex-col lg:flex-row h-full overflow-hidden relative">
      {/* Left Control & Filter Panel */}
      <div className="w-full lg:w-96 bg-white border-r border-slate-200 flex flex-col z-20 shadow-md">
        {/* Top Dropdowns */}
        <div className="p-4 border-b border-slate-100 space-y-3 bg-slate-50/50">
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider">
                Şehir Seçimi
              </label>
              {isLoading && <Loader2 className="w-3.5 h-3.5 text-blue-600 animate-spin" />}
            </div>
            <select
              value={activeCityId}
              disabled={isLoading}
              onChange={(e) => handleCityChange(e.target.value)}
              className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
            >
              {cities.map((c) => (
                <option key={c.city_id} value={c.city_id}>
                  {formatName(c.country_name)} - {formatName(c.name)} ({c.slug})
                </option>
              ))}
            </select>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider">
                Hat / Rota Seçin
              </label>
              <span className="text-xs text-slate-400">{routes.length} Hat</span>
            </div>
            <div className="relative mb-2">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400" />
              <input
                type="text"
                placeholder="Hat ara..."
                value={routeSearchText}
                onChange={(e) => setRouteSearchText(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 bg-white border border-slate-200 rounded-md text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div className="max-h-40 overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100 bg-white">
              {filteredRoutesList.length === 0 ? (
                <div className="p-3 text-xs text-slate-400 text-center">Hat bulunamadı.</div>
              ) : (
                filteredRoutesList.map((r) => {
                  const isSelected = r.route_id === activeRouteId;
                  return (
                    <button
                      key={r.route_id}
                      onClick={() => handleRouteChange(r.route_id)}
                      disabled={isLoading}
                      className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between transition disabled:opacity-50 ${
                        isSelected
                          ? "bg-blue-50 text-blue-700 font-semibold"
                          : "hover:bg-slate-50 text-slate-700"
                      }`}
                    >
                      <div className="flex items-center gap-2 truncate">
                        <span
                          className="w-3 h-3 rounded-full flex-shrink-0"
                          style={{ backgroundColor: r.color || "#2563eb" }}
                        />
                        <span className="truncate">
                          {r.code ? `[${r.code}] ` : ""}
                          {formatName(r.name)}
                        </span>
                      </div>
                      {isSelected && (
                        isLoading ? (
                          <Loader2 className="w-3.5 h-3.5 text-blue-600 animate-spin flex-shrink-0" />
                        ) : (
                          <Check className="w-3.5 h-3.5 text-blue-600 flex-shrink-0" />
                        )
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Direction Toggle */}
          {activeRouteObj && (
            <div className="pt-2">
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                Yön / Güzergah
              </label>
              {isLoopRoute ? (
                <div className="p-2.5 bg-blue-50 border border-blue-200 rounded-lg text-xs font-semibold text-blue-900 flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <RotateCw className="w-3.5 h-3.5 text-blue-600" />
                    <span>Ring Hat (Tek Yön - Loop)</span>
                  </div>
                  <span className="px-2 py-0.5 bg-blue-600 text-white text-[10px] font-bold rounded font-mono">
                    Yön 0
                  </span>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setSelectedDirection(1)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg border text-center transition ${
                      effectiveDirection === 1
                        ? "bg-blue-600 text-white border-blue-600 shadow-xs"
                        : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
                    }`}
                  >
                    Gidiş (Yön 1)
                  </button>
                  <button
                    onClick={() => setSelectedDirection(2)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg border text-center transition ${
                      effectiveDirection === 2
                        ? "bg-blue-600 text-white border-blue-600 shadow-xs"
                        : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
                    }`}
                  >
                    Dönüş (Yön 2)
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Selected Route & Stops List Panel */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {activeRouteObj ? (
            <>
              {/* Route Summary Box */}
              <div
                className="p-3.5 rounded-xl border border-slate-200/80 shadow-2xs space-y-2 bg-gradient-to-r"
                style={{
                  borderLeftWidth: "4px",
                  borderLeftColor: activeRouteObj.color || "#2563eb",
                }}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase text-slate-500">
                    {activeRouteObj.vehicle_type} • {activeRouteObj.route_pattern}
                  </span>
                  <button
                    onClick={() => setShowTimetable(!showTimetable)}
                    className="text-xs text-blue-600 font-semibold hover:underline flex items-center gap-1"
                  >
                    <Clock className="w-3.5 h-3.5" />
                    <span>{showTimetable ? "Durakları Gör" : "7 Günlük Saat Cetvelini Gör"}</span>
                  </button>
                </div>
                <h3 className="font-bold text-slate-900 text-sm">
                  {activeRouteObj.code ? `${activeRouteObj.code} - ` : ""}
                  {formatName(activeRouteObj.name)}
                </h3>
                <p className="text-xs text-slate-500">Ajans: {formatName(activeRouteObj.agency_name) || "Varsayılan"}</p>
              </div>

              {/* View Toggle: Stops vs 7-Day Timetable */}
              {!showTimetable ? (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-xs font-bold uppercase text-slate-500 tracking-wider">
                      Güzergah Durak Listesi ({currentStops.length})
                    </h4>
                  </div>

                  <div className="space-y-1.5">
                    {currentStops.length === 0 ? (
                      <p className="text-xs text-slate-400 py-4 text-center">
                        Bu hat için durak tanımlanmamış.
                      </p>
                    ) : (
                      currentStops.map((stop: any) => {
                        const isSelected = selectedStop?.stop_id === stop.stop_id;
                        return (
                          <div
                            key={stop.stop_id}
                            onClick={() => setSelectedStop(stop)}
                            className={`p-2.5 rounded-lg border text-xs cursor-pointer transition flex items-center justify-between ${
                              isSelected
                                ? "bg-blue-50 border-blue-300 text-blue-900 font-semibold shadow-2xs"
                                : "bg-white border-slate-200 text-slate-700 hover:border-slate-300"
                            }`}
                          >
                            <div className="flex items-center gap-2.5 truncate">
                              <span className="w-5 h-5 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center text-[10px] font-bold text-slate-600 flex-shrink-0">
                                {stop.sequence}
                              </span>
                              <span className="truncate">{formatName(stop.stop_name)}</span>
                            </div>
                            <MapPin className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              ) : (
                /* 7-Day Timetable View */
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold uppercase text-slate-500 tracking-wider flex items-center gap-1.5">
                      <Calendar className="w-3.5 h-3.5 text-blue-600" />
                      <span>7 Günlük Sefer Saatleri</span>
                    </h4>
                    {selectedStop && (
                      <span className="text-[10px] bg-amber-50 text-amber-800 border border-amber-200 px-1.5 py-0.5 rounded font-semibold truncate max-w-[140px]">
                        {formatName(selectedStop.stop_name)}
                      </span>
                    )}
                  </div>

                  {/* 7 Day Tabs Filter */}
                  <div className="flex items-center gap-1 overflow-x-auto pb-1 border-b border-slate-100">
                    {weekDaysList.map((d) => {
                      const isActive = selectedDay === d.id;
                      return (
                        <button
                          key={d.id}
                          onClick={() => setSelectedDay(d.id)}
                          className={`px-2 py-1 text-[11px] font-semibold rounded-md whitespace-nowrap transition ${
                            isActive
                              ? "bg-blue-600 text-white shadow-2xs"
                              : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                          }`}
                        >
                          {d.label}
                        </button>
                      );
                    })}
                  </div>

                  {/* Timetable Times Grid per Day */}
                  <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
                    {displayDays.map((dayKey) => {
                      const dayTrips = tripsByDay[dayKey] || [];
                      return (
                        <div key={dayKey} className="p-3 bg-white border border-slate-200 rounded-xl space-y-2">
                          <div className="flex items-center justify-between border-b border-slate-100 pb-1.5">
                            <span className="text-xs font-bold text-slate-900">
                              {dayFullNames[dayKey] || dayKey}
                            </span>
                            <span className="text-[10px] font-semibold text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">
                              {dayTrips.length} Sefer
                            </span>
                          </div>

                          {dayTrips.length === 0 ? (
                            <p className="text-[11px] text-slate-400 italic py-1">
                              Bu gün için tanımlı sefer bulunmuyor.
                            </p>
                          ) : (
                            <div className="flex flex-wrap gap-1.5 pt-1">
                              {dayTrips.map((t: any, i: number) => (
                                <span
                                  key={i}
                                  className="inline-flex items-center gap-1 px-2 py-1 bg-slate-50 hover:bg-blue-50 border border-slate-200 rounded-md font-mono text-xs font-bold text-slate-800 transition"
                                >
                                  <Clock className="w-3 h-3 text-blue-600" />
                                  <span>{t.departure_time || "--:--"}</span>
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="text-center py-12 text-slate-400 text-xs">
              Lütfen haritada incelemek için bir hat seçin.
            </div>
          )}
        </div>
      </div>

      {/* Right Map Canvas Area */}
      <div className="flex-1 h-full min-h-[500px] relative bg-slate-100">
        <div ref={mapContainerRef} className="w-full h-full min-h-[500px] absolute inset-0 z-10" />

        {/* Floating Top Controls Overlay */}
        <div className="absolute top-4 right-4 z-30 flex items-center gap-2">
          <button
            onClick={handleRecenterMap}
            title="Haritayı Rota ve Duraklara Odakla"
            className="bg-white/95 backdrop-blur-md hover:bg-slate-50 text-slate-800 px-3.5 py-2 rounded-full shadow-lg border border-slate-200 text-xs font-bold flex items-center gap-1.5 transition cursor-pointer"
          >
            <Focus className="w-4 h-4 text-blue-600" />
            <span>Haritayı Ortala</span>
          </button>
        </div>

        {/* Loading Indicator Floating Banner */}
        {isLoading && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 bg-white/90 backdrop-blur-md px-4 py-2 rounded-full shadow-lg border border-slate-200 text-xs font-bold text-blue-700 flex items-center gap-2 animate-bounce">
            <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
            <span>OpenStreetMap Haritası Yükleniyor...</span>
          </div>
        )}

        {/* Floating Selected Stop Card */}
        {selectedStop && (
          <div className="absolute bottom-6 right-6 z-30 max-w-sm w-full bg-white p-4 rounded-2xl shadow-xl border border-slate-200 space-y-3 animate-in fade-in slide-in-from-bottom-4 duration-200">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <div className="flex items-center gap-2">
                <MapPin className="w-4 h-4 text-blue-600" />
                <h4 className="font-bold text-slate-900 text-sm">{formatName(selectedStop.stop_name)}</h4>
              </div>
              <button
                onClick={() => setSelectedStop(null)}
                className="text-xs font-bold text-slate-400 hover:text-slate-600 p-1"
              >
                ✕
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="p-2 bg-slate-50 rounded-lg">
                <span className="text-slate-400 block text-[10px]">Durak Kodu</span>
                <span className="font-mono font-semibold text-slate-800">{selectedStop.stop_id}</span>
              </div>
              <div className="p-2 bg-slate-50 rounded-lg">
                <span className="text-slate-400 block text-[10px]">Sıra Numarası</span>
                <span className="font-semibold text-slate-800">#{selectedStop.sequence}</span>
              </div>
            </div>

            <div className="text-xs text-slate-600 space-y-1">
              <p>
                <span className="font-semibold text-slate-700">Erişilebilirlik:</span>{" "}
                {selectedStop.wheelchair_accessible ? "Tekerlekli Sandalye Uyumlu ✅" : "Bilgi Yok ℹ️"}
              </p>
              <p>
                <span className="font-semibold text-slate-700">Canlı Ekran:</span>{" "}
                {selectedStop.has_real_time_display ? "Var ✅" : "Yok ❌"}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
