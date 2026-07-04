import { useState, useCallback } from 'react';
import type { Location, District, Road, WaterBody } from '../types';

export function useMapData() {
  const [locations, setLocations] = useState<Location[]>([]);
  const [districts, setDistricts] = useState<District[]>([]);
  const [roads, setRoads] = useState<Road[]>([]);
  const [waterBodies, setWaterBodies] = useState<WaterBody[]>([]);
  const [overpasses, setOverpasses] = useState<any[]>([]);

  const fetchLocations = useCallback(() => {
    fetch(`/api/locations?_t=${Date.now()}`)
      .then(res => res.json())
      .then(data => setLocations(data))
      .catch(err => console.error('Error fetching locations:', err));
  }, []);

  const fetchDistricts = useCallback(() => {
    fetch(`/api/districts?_t=${Date.now()}`)
      .then(res => res.json())
      .then(data => setDistricts(data))
      .catch(err => console.error('Error fetching districts:', err));
  }, []);

  const fetchRoads = useCallback(() => {
    fetch(`/api/roads?_t=${Date.now()}`)
      .then(res => res.json())
      .then(data => setRoads(data))
      .catch(err => console.error('Error fetching roads:', err));
  }, []);

  const fetchWaterBodies = useCallback(() => {
    fetch(`/api/water?_t=${Date.now()}`)
      .then(res => res.json())
      .then(data => setWaterBodies(data))
      .catch(err => console.error('Error fetching water:', err));
  }, []);

  const fetchOverpasses = useCallback(() => {
    fetch(`/api/overpasses?_t=${Date.now()}`)
      .then(res => res.json())
      .then(data => setOverpasses(data))
      .catch(err => console.error('Error fetching overpasses:', err));
  }, []);

  const fetchAll = useCallback(() => {
    fetchLocations();
    fetchDistricts();
    fetchRoads();
    fetchWaterBodies();
    fetchOverpasses();
  }, [fetchLocations, fetchDistricts, fetchRoads, fetchWaterBodies, fetchOverpasses]);

  return {
    locations, setLocations,
    districts, setDistricts,
    roads, setRoads,
    waterBodies, setWaterBodies,
    overpasses, setOverpasses,
    fetchLocations, fetchDistricts, fetchRoads, fetchWaterBodies, fetchOverpasses, fetchAll,
  };
}
