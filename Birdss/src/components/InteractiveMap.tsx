import { useEffect, useRef, useState } from "react";
import { Loader2, MapPin } from "lucide-react";

interface Props {
  lat: number | "";
  lon: number | "";
  onChange: (lat: number, lon: number) => void;
}

export function InteractiveMap({ lat, lon, onChange }: Props) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const mapRef = useRef<any>(null);
  const markerRef = useRef<any>(null);

  // Load Leaflet dynamically from CDN
  useEffect(() => {
    if ((window as any).L) {
      setLoading(false);
      setMapLoaded(true);
      return;
    }

    const cssLink = document.createElement("link");
    cssLink.rel = "stylesheet";
    cssLink.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
    document.head.appendChild(cssLink);

    const script = document.createElement("script");
    script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
    script.onload = () => {
      setLoading(false);
      setMapLoaded(true);
    };
    document.head.appendChild(script);

    return () => {
      // Clean up script if unmounted before load, though in practice we keep it
    };
  }, []);

  // Initialize and update Map
  useEffect(() => {
    if (!mapLoaded || !mapContainerRef.current || !(window as any).L) return;

    const L = (window as any).L;

    // Default center (Nepal region or selected lat/lon)
    const initialLat = lat !== "" ? lat : 27.7172;
    const initialLon = lon !== "" ? lon : 85.3240;
    const zoom = lat !== "" ? 11 : 7;

    if (!mapRef.current) {
      // Initialize map
      const map = L.map(mapContainerRef.current, {
        zoomControl: false,
        attributionControl: false
      }).setView([initialLat, initialLon], zoom);

      // Add stylish terrain-like tiles (CartoDB Positron or similar clean tiles)
      L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
        maxZoom: 19
      }).addTo(map);

      // Custom Zoom Control at bottom right
      L.control.zoom({
        position: "bottomright"
      }).addTo(map);

      mapRef.current = map;

      // Handle map clicks
      map.on("click", (e: any) => {
        const { lat: clickLat, lng: clickLon } = e.latlng;
        onChange(+clickLat.toFixed(5), +clickLon.toFixed(5));
      });
    }

    const mapInstance = mapRef.current;

    // Update marker position
    if (lat !== "" && lon !== "") {
      const pos: [number, number] = [lat, lon];
      
      if (!markerRef.current) {
        // Create custom green marker
        const greenIcon = L.divIcon({
          html: `<div class="relative flex items-center justify-center">
                   <div class="absolute h-8 w-8 rounded-full bg-emerald-500/30 animate-ping"></div>
                   <div class="h-5 w-5 rounded-full border-2 border-white bg-emerald-600 shadow-md"></div>
                 </div>`,
          className: "",
          iconSize: [20, 20],
          iconAnchor: [10, 10]
        });

        markerRef.current = L.marker(pos, { icon: greenIcon }).addTo(mapInstance);
      } else {
        markerRef.current.setLatLng(pos);
      }

      // Fly to location smoothly if it's the first coordinate or changes significantly
      const center = mapInstance.getCenter();
      const dist = Math.sqrt(Math.pow(center.lat - lat, 2) + Math.pow(center.lng - lon, 2));
      if (dist > 0.05) {
        mapInstance.flyTo(pos, mapInstance.getZoom(), { duration: 1.5 });
      }
    } else {
      if (markerRef.current) {
        markerRef.current.remove();
        markerRef.current = null;
      }
    }
  }, [mapLoaded, lat, lon]);

  return (
    <div className="relative w-full h-72 rounded-2xl overflow-hidden border border-border bg-secondary/20 shadow-inner">
      {loading && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-card/60 backdrop-blur-sm z-10">
          <Loader2 className="h-8 w-8 animate-spin text-primary mb-2" />
          <p className="text-xs text-muted-foreground">Loading interactive map...</p>
        </div>
      )}
      
      <div ref={mapContainerRef} className="w-full h-full z-0" />
      
      {lat === "" && (
        <div className="absolute top-3 left-3 bg-card/90 backdrop-blur border border-border px-3 py-1.5 rounded-lg text-xs flex items-center gap-1.5 shadow pointer-events-none z-10 animate-pulse">
          <MapPin className="h-3.5 w-3.5 text-primary" />
          <span>Click on the map to anchor your forest</span>
        </div>
      )}
    </div>
  );
}
