import type { Car } from '../api/queries';

interface Props {
  cars: Car[];
  selectedId: number | undefined;
  onChange: (id: number) => void;
}

export default function CarSelector({ cars, selectedId, onChange }: Props) {
  if (cars.length <= 1) return null;

  return (
    <div className="flex gap-2 px-4 py-2 overflow-x-auto">
      {cars.map((car) => (
        <button
          key={car.id}
          onClick={() => onChange(car.id)}
          className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors duration-150 min-h-[44px] ${
            selectedId === car.id
              ? 'bg-[#e31937] text-white'
              : 'bg-[#1a1a1a] text-[#9ca3af] border border-[#2a2a2a]'
          }`}
        >
          {car.name || car.marketingName || car.model || `Car ${car.id}`}
        </button>
      ))}
    </div>
  );
}
