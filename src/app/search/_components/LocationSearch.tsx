'use client';

import { useRef, useState } from 'react';
import { useMapsLibrary } from '@vis.gl/react-google-maps';
import { Input } from '@/components/ui/input';
import { Search } from 'lucide-react';

export function LocationSearch({
  defaultValue,
  onSelect,
}: {
  defaultValue: string;
  onSelect: (result: { label: string; lat: number; lng: number }) => void;
}) {
  const placesLib = useMapsLibrary('places');
  const [input, setInput] = useState(defaultValue);
  const [predictions, setPredictions] = useState<google.maps.places.AutocompletePrediction[]>([]);
  const autocomplete = useRef<google.maps.places.AutocompleteService | null>(null);
  const placesService = useRef<google.maps.places.PlacesService | null>(null);

  if (placesLib && !autocomplete.current) {
    autocomplete.current = new placesLib.AutocompleteService();
  }
  if (placesLib && !placesService.current) {
    placesService.current = new placesLib.PlacesService(document.createElement('div'));
  }

  function handleChange(value: string) {
    setInput(value);
    if (!value || !autocomplete.current) {
      setPredictions([]);
      return;
    }
    autocomplete.current.getPlacePredictions(
      { input: value, types: ['(regions)'] },
      (results) => setPredictions(results ?? [])
    );
  }

  function handleSelect(prediction: google.maps.places.AutocompletePrediction) {
    if (!placesService.current) return;
    placesService.current.getDetails({ placeId: prediction.place_id, fields: ['geometry', 'name'] }, (place, status) => {
      if (status !== google.maps.places.PlacesServiceStatus.OK || !place?.geometry?.location) return;
      setInput(place.name ?? prediction.description);
      setPredictions([]);
      onSelect({
        label: place.name ?? prediction.description,
        lat: place.geometry.location.lat(),
        lng: place.geometry.location.lng(),
      });
    });
  }

  return (
    <div className="relative">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#0e1c36]/40" />
        <Input
          value={input}
          onChange={(e) => handleChange(e.target.value)}
          placeholder="Search a city or area..."
          className="pl-9"
        />
      </div>
      {predictions.length > 0 && (
        <div className="absolute z-20 mt-1 w-full rounded-lg border border-[#0e1c36]/12 bg-white shadow-lg overflow-hidden">
          {predictions.map((p) => (
            <button
              key={p.place_id}
              type="button"
              onClick={() => handleSelect(p)}
              className="block w-full px-4 py-2.5 text-left text-sm text-[#0e1c36] hover:bg-[#0e1c36]/5"
            >
              {p.description}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
