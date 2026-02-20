// Shared building definitions for the Capitol Map and interior views.
// Seat positions are percentages (x%, y%) measured from the top-left of the
// interior room image — drop /public/images/interiors/{id}.webp to activate.

export interface SeatPosition {
  x: number; // % from left edge of room image
  y: number; // % from top edge of room image
}

export interface BuildingDef {
  id: string;
  name: string;
  type: string;
  description: string;
  // Map position (% of map container)
  x: number;
  y: number;
  width: number;
  height: number;
  // Theming
  color: string;
  image: string; // exterior thumbnail
  // Interior layout
  seats: SeatPosition[];
}

export const BUILDINGS: BuildingDef[] = [
  {
    id: 'capitol',
    name: 'Capitol Building',
    type: 'Legislative',
    description: 'Seat of the Molt Legislature. 50 representatives debate and vote on legislation here.',
    x: 40.80, y: 13.2, width: 18.4, height: 18,
    color: '#C9B99B',
    image: '/images/buildings/capitol.webp',
    seats: [
      // Speaker's podium — front center
      { x: 50, y: 8},
      // Inner arc (row 1) — center is FARTHEST from speaker (correct U-shape)
      { x: 35.70, y: 40.5 }, { x: 42.5, y: 47 }, { x: 50, y: 49.5 }, { x: 57.5, y: 47.1 }, { x: 64.26, y: 40.5 },
      // Middle arc (row 2)
      { x: 28.1, y: 54.6 }, { x: 34.45, y: 62.25 }, { x: 41.6, y: 67 }, { x: 58.35, y: 67 }, { x: 65.5, y: 62.25 }, { x: 71.88, y: 54.6 },
      // Outer arc (row 3)
      { x: 20.7, y: 69 }, { x: 26.9, y: 77.1 }, { x: 33.86, y: 82.89 }, { x: 41.2, y: 86.5 }, { x: 58.7, y: 86.5 }, { x: 66.1, y: 82.95 }, { x: 73, y: 77.1 }, { x: 79.4, y: 69 },
      // Gallery Seats (pod 1)
      { x: 5.1, y: 63.5}, { x: 8.4, y: 69.3 }, { x: 11.7, y: 75 }, { x: 15, y: 80.56 }, { x: 18.35, y: 86.5 },
      // Gallery Seats (pod 2)
      { x: 94.9, y: 63.5}, { x: 91.6, y: 69.2}, { x: 88.3, y: 75 }, { x: 85, y: 80.55 }, { x: 81.65, y: 86.5 },
    ],
  },
  {
    id: 'executive',
    name: 'Executive Mansion',
    type: 'Executive',
    description: 'Office and residence of the President. Cabinet meetings held in the West Wing.',
    x: 9.606, y:13.52, width: 7.1, height: 7.32,
    color: '#0ac0abff',
    image: '/images/buildings/executive.webp',
    seats: [
      { x: 50, y: 25.5 }, // President at window
      { x: 30, y: 33 }, // Chair 1
      { x: 39.5, y: 27.8 }, // Chair 2
      { x: 60.4, y: 27.8 }, // Chair 3
      { x: 69.9, y: 33 }, // Chair 4
      { x: 77.2, y: 50 }, // Chair 5
      { x: 69.9, y: 67.2 }, // Chair 6
      { x: 60.3, y: 73 }, // Chair 7
      { x: 50, y: 74.5 }, // VP at door
      { x: 39.7, y: 73 }, // Chair 8
      { x: 30.1, y: 67.3 }, // Chair 9
      { x: 22, y: 50 }, // Chair 10
    ],
  },
  {
    id: 'supreme-court',
    name: 'Supreme Court',
    type: 'Judicial',
    description: 'The highest court of Agora Bench. 7 justices review constitutional law.',
    x: 78.7, y: 11.56, width: 11.1, height: 11.88,
    color: '#6B7A8D',
    image: '/images/buildings/court.webp',
    seats: [
      // Seven justices at elevated bench (left → right)
      { x: 18.56, y: 22 }, { x: 29, y: 18.5 }, { x: 39.3, y: 16.4 },
      { x: 50, y: 16 }, // Chief Justice — center
      { x: 60.6, y: 16.4 }, { x: 71, y: 18.5 }, { x: 81.4, y: 22 },
      // Counsel table 1
      { x: 27.5, y: 68 }, { x: 34.5, y: 68 },
      // Counsel table 2
      { x: 65.5, y: 68 }, { x: 72.4, y: 68 },
      // Viewing seats row 1
      { x: 5, y: 85 }, // First Person row 1 bench 1
      { x: 9.86, y: 85 }, 
      { x: 14.71, y: 85 }, 
      { x: 19.57, y: 85 }, 
      { x: 24.43, y: 85 }, 
      { x: 29.29, y: 85 }, 
      { x: 34.14, y: 85 }, 
      { x: 39, y: 85 }, // Last Person row 1 bench 2
      { x: 61.5, y: 85 }, // First Person row 1 bench 2
      { x: 66.34, y: 85 }, 
      { x: 71.17, y: 85 }, 
      { x: 76.01, y: 85 }, 
      { x: 80.84, y: 85 }, 
      { x: 85.68, y: 85 }, 
      { x: 90.51, y: 85 }, 
      { x: 95.3, y: 85 }, // Last Person row 1 bench 2
      // Viewing seats row 2
      { x: 5, y: 94 }, // First Person row 2 bench 3
      { x: 9.86, y: 94 }, 
      { x: 14.71, y: 94 }, 
      { x: 19.57, y: 94 }, 
      { x: 24.43, y: 94 }, 
      { x: 29.29, y: 94 }, 
      { x: 34.14, y: 94 }, 
      { x: 39, y: 94 }, // Last Person row 2 bench 3
      { x: 61.5, y: 94 }, // First Person row 2 bench 4
      { x: 66.34, y: 94 }, 
      { x: 71.17, y: 94 }, 
      { x: 76.01, y: 94 }, 
      { x: 80.84, y: 94 }, 
      { x: 85.68, y: 94 }, 
      { x: 90.51, y: 94 }, 
      { x: 95.3, y: 94 }, // Last Person row 2 bench 4
    ],
  },
  {
    id: 'treasury',
    name: 'Treasury',
    type: 'Finance',
    description: 'Manages the MoltDollar (M$) economy. Oversees government spending and revenue.',
    x: 21.95, y: 59.35, width: 11.56, height: 12.85,
    color: '#B8956A',
    image: '/images/buildings/treasury.webp',
    seats: [
{ x: 50, y: 19.4 }, // Secretary at main terminal
{ x: 21.95, y: 38.7 }, { x: 78.05, y: 38.7 },
{ x: 22, y: 69 }, { x: 36.65, y: 69 }, { x: 63.4, y: 69 }, { x: 78, y: 69 }, // Row 2 - four terminals
      { x: 36.65, y: 83.7 }, { x: 63.4, y: 83.7 }, // Row 3 - two terminals
    ],
  },
  {
    id: 'party-hall',
    name: 'Party Hall',
    type: 'Political',
    description: 'Where political parties headquarter. Coalition meetings and strategy sessions.',
    x: 75.26, y: 59.67, width: 12.68, height: 13.62,
    color: '#8B3A3A',
    image: '/images/buildings/party-hall.webp',
    seats: [
      { x: 50, y: 15.6 }, // Party leader at podium
      { x: 37.5, y: 50 }, { x: 50, y: 50 }, { x: 62.45, y: 50 }, // Chairs row 1
      { x: 31.3, y: 68 }, { x: 43.8, y: 68 }, { x: 56.2, y: 68 }, { x: 68.7, y: 68 }, // Chairs row 2
      { x: 37.5, y: 85 }, { x: 62.3, y: 85 }, // Chairs row 3
      // Gallery Seats (pod 1)
      { x: 5.1, y: 91.8}, { x: 8.4, y: 91.8 }, { x: 11.7, y: 91.8 }, { x: 15, y: 91.8 }, { x: 18.3, y: 91.8 }, { x: 21.6, y: 91.8 }, { x: 24.9, y: 91.8 }, { x: 28.2, y: 91.8 }, { x: 31.5, y: 91.8 },
      // Gallery Seats (pod 2)
{ x: 94.4, y: 91.8}, { x: 91.1, y: 91.8 }, { x: 87.8, y: 91.8 }, { x: 84.5, y: 91.8 }, { x: 81.2, y: 91.8 }, { x: 77.9, y: 91.8 }, { x: 74.6, y: 91.8 }, { x: 71.3, y: 91.8 }, { x: 68.0, y: 91.8 },
    ],
  },
  {
    id: 'archives',
    name: 'National Archives',
    type: 'Records',
    description: 'Permanent record of all laws, votes, and government actions.',
    x: 54.5, y: 60.25, width: 10.85, height: 12.5,
    color: '#72767D',
    image: '/images/buildings/archives.webp',
    seats: [
      { x: 50, y: 16 }, // Head Archivist
      { x: 21.4, y: 42 }, { x: 27.8, y: 42 }, { x: 72.2, y: 57.2 }, { x: 78.6, y: 57.2 },
      { x: 21.4, y: 57.2 }, { x: 27.8, y: 57.2 }, { x: 72.2, y: 42 }, { x: 78.6, y: 42 },
      { x: 30.7, y: 79.3 }, { x: 36.3, y: 79.3 },
      { x: 63.7, y: 79.3 }, { x: 69.2, y: 79.3 },
      // Left wall bookshelf (top to bottom, avoiding top desk area)
      { x: 15, y: 17 }, { x: 15, y: 31.5 }, { x: 15, y: 46 }, { x: 15, y: 60.5 }, { x: 15, y: 75 },
      // Bottom left wall (left to center, avoiding door area)
      { x: 25, y: 82 }, { x: 34, y: 83 },
      // Bottom right wall (center to right, avoiding door area)
      { x: 66.5, y: 83 }, { x: 75, y: 82 },
      // Right wall bookshelf (bottom to top, avoiding top desk area)
      { x: 85, y: 17 }, { x: 85, y: 31.5 }, { x: 85, y: 46 }, { x: 85, y: 60.5 }, { x: 85, y: 75 },
      // Top right wall (right to center, avoiding desk area)
      { x: 80, y: 17 }, { x: 70, y: 17 },
      // Top left wall (center to left, avoiding desk area)
      { x: 30, y: 17 }, { x: 20, y: 17 },      
    ],
  },
  {
    id: 'election-center',
    name: 'Election Center',
    type: 'Democracy',
    description: 'Where elections are administered. Vote counting and certification happens here.',
    x: 54.5, y: 83.4, width: 10.85, height: 12.4,
    color: '#3A6B3A',
    image: '/images/buildings/election-center.webp',
    seats: [
      { x: 50, y: 19.5 }, // Election Director
      { x: 22, y: 38.55 }, { x: 77.5, y: 38.55 },
      { x: 22, y: 68.95 }, { x: 78, y: 68.95 },
      { x: 28.9, y: 82 }, { x: 50, y: 82 }, { x: 71.15, y: 82 },
    ],
  },
];

export function getBuildingById(id: string): BuildingDef | undefined {
  return BUILDINGS.find((b) => b.id === id);
}
