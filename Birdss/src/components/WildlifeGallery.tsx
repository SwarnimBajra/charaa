import { useEffect, useState } from "react";
import { fetchLocalWikimediaImages, type WikimediaImage } from "@/lib/scenePlanner";
import { Loader2, Image as ImageIcon, Camera, User } from "lucide-react";

interface Props {
  lat: number | "";
  lon: number | "";
}

export function WildlifeGallery({ lat, lon }: Props) {
  const [images, setImages] = useState<WikimediaImage[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (lat === "" || lon === "") {
      setImages([]);
      return;
    }

    let active = true;
    async function loadImages() {
      setLoading(true);
      try {
        const data = await fetchLocalWikimediaImages(Number(lat), Number(lon));
        if (active) {
          setImages(data);
        }
      } catch (err) {
        console.error("Failed to load local wildlife images:", err);
      } finally {
        if (active) setLoading(false);
      }
    }

    loadImages();
    return () => {
      active = false;
    };
  }, [lat, lon]);

  if (lat === "" || lon === "") return null;

  return (
    <div className="rounded-3xl bg-card border border-border p-6 shadow-soft space-y-6">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-xl bg-gradient-forest text-primary-foreground flex items-center justify-center shadow-md">
          <Camera className="h-5 w-5" />
        </div>
        <div>
          <h3 className="font-display text-2xl font-bold tracking-tight">Wildlife & Ecological Media</h3>
          <p className="text-xs text-muted-foreground">
            Geolocated wildlife photos captured near this region from Wikimedia Commons
          </p>
        </div>
      </div>

      {loading ? (
        <div className="h-48 flex flex-col items-center justify-center text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin text-primary mb-2" />
          <p className="text-xs">Scanning Wikimedia Commons database...</p>
        </div>
      ) : images.length === 0 ? (
        <div className="h-36 flex flex-col items-center justify-center border border-dashed border-border rounded-2xl bg-secondary/15 text-center px-4">
          <ImageIcon className="h-8 w-8 text-muted-foreground/60 mb-2" />
          <p className="text-sm font-semibold">No geotagged media found</p>
          <p className="text-xs text-muted-foreground max-w-sm mt-1">
            Be the first to upload geolocated wildlife observations for this coordinate to Wikimedia Commons!
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {images.map((img) => (
            <div
              key={img.pageid}
              className="group relative rounded-2xl overflow-hidden border border-border bg-secondary/10 flex flex-col transition-all duration-300 hover:shadow-md hover:border-primary/20"
            >
              {/* Image box */}
              <div className="relative h-44 overflow-hidden bg-muted shrink-0">
                <img
                  src={img.url}
                  alt={img.title}
                  loading="lazy"
                  className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                  onError={(e) => {
                    e.currentTarget.style.display = "none";
                  }}
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-end p-3">
                  {img.author && (
                    <span className="text-[10px] text-white/90 flex items-center gap-1">
                      <User className="h-3 w-3 shrink-0" />
                      Captured by {img.author.slice(0, 20)}
                    </span>
                  )}
                </div>
              </div>

              {/* Title / Description */}
              <div className="p-3 flex-1 flex flex-col justify-between space-y-2">
                <div>
                  <h4 className="text-xs font-bold text-foreground line-clamp-1 group-hover:text-primary transition-colors">
                    {img.title}
                  </h4>
                  {img.description && (
                    <p className="text-[11px] text-muted-foreground line-clamp-2 mt-1 leading-relaxed">
                      {img.description}
                    </p>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
