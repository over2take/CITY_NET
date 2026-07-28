import { useEffect } from 'react';
import { useMapExport, type MapExportOptions } from '../hooks/useMapExport';
import type {
  BoundsLocation,
  BoundsRoad,
  BoundsWaterBody,
  BoundsOverpass,
} from '../utils/mapExportBounds';

export interface MapExportApi {
  exportPng: (opts?: MapExportOptions) => void;
  startRecording: (opts?: MapExportOptions) => void | Promise<void>;
  stopRecording: () => void;
  isRecording: boolean;
  isExporting: boolean;
}

interface Props {
  locations: BoundsLocation[];
  roads: BoundsRoad[];
  waterBodies: BoundsWaterBody[];
  overpasses: BoundsOverpass[];
  /** Called whenever the export API changes, so App can hand it to the AdminPanel. */
  onReady: (api: MapExportApi) => void;
}

/**
 * Bridge between the R3F canvas and the React tree.
 *
 * `useMapExport` needs `useThree()`, which only works inside the Canvas, but the
 * buttons that drive it live in the AdminPanel outside it. This component renders
 * nothing and exists purely to lift that API out.
 */
export default function MapExportController({
  locations,
  roads,
  waterBodies,
  overpasses,
  onReady,
}: Props) {
  const api = useMapExport({ locations, roads, waterBodies, overpasses });

  const { exportPng, startRecording, stopRecording, isRecording, isExporting } = api;

  useEffect(() => {
    onReady({ exportPng, startRecording, stopRecording, isRecording, isExporting });
  }, [onReady, exportPng, startRecording, stopRecording, isRecording, isExporting]);

  return null;
}
