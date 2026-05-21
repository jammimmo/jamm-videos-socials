// Neighborhood data — bilingual Wolof / French
// Backgrounds now use JAMM brand blue family

export type Neighborhood = {
  id: string;
  name: string;
  tagline: { fr: string; wo: string };
  size: string;
  rent: number;
  pin: { x: number; y: number };
  buildingStyle: 'colonial' | 'modern' | 'coastal' | 'block' | 'suburban';
  accent: string;
  bgGradient: [string, string];
  silhouette: 'highrise' | 'palms' | 'beach' | 'lowrise' | 'distant';
  pros: { fr: string; wo: string }[];
  cons: { fr: string; wo: string }[];
};

// All bg gradients use the brand blue family for unified identity
// Accents differentiate each neighborhood
export const neighborhoods: Neighborhood[] = [
  {
    id: 'plateau',
    name: 'Plateau',
    tagline: { fr: 'Le cœur business', wo: 'Diggu liggéey bi' },
    size: '20 m²',
    rent: 300000,
    pin: { x: 410, y: 720 },
    buildingStyle: 'colonial',
    accent: '#F4C430', // gold
    bgGradient: ['#141B52', '#2B3388'],
    silhouette: 'highrise',
    pros: [
      { fr: 'Tout à pied', wo: 'Dox-dox rekk' },
      { fr: 'Près des bureaux', wo: 'Gëstu liggéey' },
    ],
    cons: [
      { fr: 'Studio minuscule', wo: 'Bu tuuti lool' },
      { fr: 'Bruyant la nuit', wo: 'Coow ci guddi' },
    ],
  },
  {
    id: 'almadies',
    name: 'Almadies',
    tagline: { fr: 'Luxe en bord de mer', wo: 'Bord de mer bu rafet' },
    size: '18 m²',
    rent: 300000,
    pin: { x: 220, y: 540 },
    buildingStyle: 'modern',
    accent: '#E49536', // brand orange
    bgGradient: ['#141B52', '#2B3388'],
    silhouette: 'palms',
    pros: [
      { fr: 'Brise océan', wo: 'Ngelaw mu seer' },
      { fr: 'Quartier moderne', wo: 'Dëkk bu bees' },
    ],
    cons: [
      { fr: 'Petit pour le prix', wo: 'Tuuti ci njëgam' },
      { fr: 'Embouteillages', wo: 'Coow ci yoon wi' },
    ],
  },
  {
    id: 'yoff',
    name: 'Yoff',
    tagline: { fr: 'Plage et tradition', wo: 'Gëj ak aada' },
    size: '32 m²',
    rent: 300000,
    pin: { x: 360, y: 460 },
    buildingStyle: 'coastal',
    accent: '#4FC3F7', // sky blue
    bgGradient: ['#141B52', '#2B3388'],
    silhouette: 'beach',
    pros: [
      { fr: 'Près de la plage', wo: 'Jegeñ gëj gi' },
      { fr: 'Bon rapport prix', wo: 'Prix bu yomb' },
    ],
    cons: [
      { fr: 'Loin du centre', wo: 'Sori diggu réew' },
      { fr: 'Rues poussiéreuses', wo: 'Yoon yu tax' },
    ],
  },
  {
    id: 'parcelles',
    name: 'Parcelles Assainies',
    tagline: { fr: 'Quartier familial', wo: 'Dëkk bu njaboot' },
    size: '45 m²',
    rent: 300000,
    pin: { x: 480, y: 480 },
    buildingStyle: 'block',
    accent: '#F4C430',
    bgGradient: ['#141B52', '#2B3388'],
    silhouette: 'lowrise',
    pros: [
      { fr: 'Grand espace', wo: 'Bare ci yaa' },
      { fr: 'Marchés locaux', wo: 'Marse yu bare' },
    ],
    cons: [
      { fr: 'Trajet long', wo: 'Yoon wu gudd' },
      { fr: 'Inondations hivernage', wo: 'Mbën ci nawet' },
    ],
  },
  {
    id: 'keur-massar',
    name: 'Keur Massar',
    tagline: { fr: 'Grand pour le prix', wo: 'Bi gëna réy' },
    size: '60 m²',
    rent: 300000,
    pin: { x: 760, y: 480 },
    buildingStyle: 'suburban',
    accent: '#A78BFA',
    bgGradient: ['#141B52', '#2B3388'],
    silhouette: 'distant',
    pros: [
      { fr: '2-3 chambres', wo: '2-3 néeg' },
      { fr: 'Constructions neuves', wo: 'Tabax yu bees' },
    ],
    cons: [
      { fr: 'Très loin du centre', wo: 'Sori lool' },
      { fr: 'Transports limités', wo: 'Transport bu néew' },
    ],
  },
];
