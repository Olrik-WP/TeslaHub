interface Props {
  lat?: number | null;
  lng?: number | null;
}

export default function WazeEmbed({ lat, lng }: Props) {
  const baseUrl = 'https://www.waze.com/live-map/';
  const url =
    lat != null && lng != null
      ? `${baseUrl}?zoom=15&lat=${lat}&lng=${lng}`
      : baseUrl;

  return (
    <div className="relative w-full h-full min-h-[400px]">
      <iframe
        src={url}
        allow="geolocation"
        className="w-full h-full border-0 rounded-xl"
        title="Waze Live Map"
      />
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="absolute bottom-4 right-4 bg-[#e31937] text-white px-4 py-2 rounded-lg text-sm font-medium min-h-[44px] flex items-center"
      >
        Ouvrir Waze
      </a>
    </div>
  );
}
