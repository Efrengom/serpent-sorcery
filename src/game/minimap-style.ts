/**
 * The minimap's colours, shared with the atlas on the setup screen. Apart from the minimap itself,
 * so the menus can draw the atlas without loading the run.
 */
export const MINIMAP_HAZARDS = { lava: '#d8461c', bramble: '#9a3aa8', ice: '#a8d8f0' } as const;

/** Minimap colours per area: the ruins, the Ember Depths, the Mycelium Hollows, the Rimefrost Catacombs. */
export const MINIMAP_STYLE = [
  { floor: '#1d1233', stone: '#4f3f78', edge: '#9a88cc', frame: '#0d0718', landmark: '#e4d8ff' },
  { floor: '#24100b', stone: '#6a3a26', edge: '#c87a4e', frame: '#120504', landmark: '#ffd8b0' },
  { floor: '#0c1c1e', stone: '#2e5a52', edge: '#5fd8c0', frame: '#061012', landmark: '#ffc8f0' },
  { floor: '#101a2c', stone: '#3e5878', edge: '#a8d0f0', frame: '#070c18', landmark: '#e8f4ff' },
];
