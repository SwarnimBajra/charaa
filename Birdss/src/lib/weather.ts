export interface WeatherSnapshot {
  main: string;
  description: string;
  tempC: number;
  humidity: number;
  windMps: number;
  iconUrl: string;
  fetchedAt: number;
}

export async function fetchOpenWeather(lat: number, lon: number): Promise<WeatherSnapshot | null> {
  const key = import.meta.env.VITE_OPENWEATHER_KEY || "";
  if (!key) return null;

  const url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&units=metric&appid=${key}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`OpenWeather error ${res.status}`);
  const data = await res.json();

  const weather = Array.isArray(data.weather) && data.weather.length ? data.weather[0] : null;
  const icon = weather?.icon ? `https://openweathermap.org/img/wn/${weather.icon}@2x.png` : "";

  return {
    main: weather?.main || "Unknown",
    description: weather?.description || "",
    tempC: typeof data.main?.temp === "number" ? data.main.temp : 0,
    humidity: typeof data.main?.humidity === "number" ? data.main.humidity : 0,
    windMps: typeof data.wind?.speed === "number" ? data.wind.speed : 0,
    iconUrl: icon,
    fetchedAt: Date.now(),
  };
}
