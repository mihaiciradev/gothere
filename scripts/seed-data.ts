/**
 * Fictional demonstration ecosystem. All names, venues, artists and people are invented.
 * Email domains use the reserved .test TLD so they can never reach a real inbox.
 * Photography: Unsplash License (free commercial use); sources and credits in docs/assets.md.
 */

export type SeedUser = {
  key: string;
  name: string;
  email: string;
  platformRole: "attendee" | "platform_admin";
  password: "demo" | "admin";
};

export const seedUsers: SeedUser[] = [
  { key: "maya", name: "Maya Ionescu", email: "maya@attendee.gothere.test", platformRole: "attendee", password: "demo" },
  { key: "luca", name: "Luca Marin", email: "luca@attendee.gothere.test", platformRole: "attendee", password: "demo" },
  { key: "irina", name: "Irina Vlad", email: "irina@tidal.gothere.test", platformRole: "attendee", password: "demo" },
  { key: "radu", name: "Radu Petrescu", email: "radu@tidal.gothere.test", platformRole: "attendee", password: "demo" },
  { key: "sam", name: "Sam Okafor", email: "sam@northlight.gothere.test", platformRole: "attendee", password: "demo" },
  { key: "ops", name: "Platform Operations", email: "ops@control.gothere.test", platformRole: "platform_admin", password: "admin" },
];

export type SeedOrganization = {
  slug: string;
  name: string;
  members: { user: string; role: "owner" | "manager" | "analyst" }[];
};

export const seedOrganizations: SeedOrganization[] = [
  {
    slug: "tidal-assembly",
    name: "Tidal Assembly",
    members: [
      { user: "irina", role: "owner" },
      { user: "radu", role: "analyst" },
    ],
  },
  { slug: "northlight-live", name: "Northlight Live", members: [{ user: "sam", role: "owner" }] },
];

const unsplash = (id: string) => `https://images.unsplash.com/${id}`;
const credit = (name: string) => `Photo: ${name} / Unsplash`;

type SeedInventory = { name: string; description?: string; priceMinor: number; capacity: number; maxPerOrder?: number };

export type SeedExperience = {
  slug: string;
  title: string;
  description: string;
  category: string;
  location: string;
  startsAt: string;
  endsAt: string;
  imageUrl: string;
  imageCredit: string;
  inventory: SeedInventory;
};

export type SeedEvent = {
  organization: string;
  slug: string;
  title: string;
  category: "festival" | "concert" | "club" | "culture";
  summary: string;
  description: string;
  venueName: string;
  city: string;
  countryCode: string;
  timeZone: string;
  startsAt: string;
  endsAt: string;
  heroImageUrl: string;
  heroImageCredit: string;
  admissions: SeedInventory[];
  experiences: SeedExperience[];
};

export const seedEvents: SeedEvent[] = [
  {
    organization: "tidal-assembly",
    slug: "halcyon-shore-2027",
    title: "Halcyon Shore 2027",
    category: "festival",
    summary: "Three days of electronic music, sea air and sunrise sets on the Black Sea coast.",
    description:
      "Halcyon Shore returns to the Saltmarsh Dunes for its fifth edition. Four stages are dug into the sand between the reed beds and the water, the pier hosts a sunset set each evening, and the programme runs until the sun comes back up. Around the music, a short list of small-format experiences — a chef's table, a producer session, yoga at first light — can be booked alongside your pass. Capacity is deliberately limited so the beach never feels crowded.",
    venueName: "Saltmarsh Dunes",
    city: "Constanța",
    countryCode: "RO",
    timeZone: "Europe/Bucharest",
    startsAt: "2027-07-09T14:00:00+03:00",
    endsAt: "2027-07-12T06:00:00+03:00",
    heroImageUrl: unsplash("photo-1705852971897-36ed5c9b02b1"),
    heroImageCredit: credit("Aleksei Zhivilov"),
    admissions: [
      { name: "3-Day General Admission", description: "All stages, all three days.", priceMinor: 18900, capacity: 12000 },
      { name: "3-Day VIP", description: "Dedicated entrance, shaded terrace and lockers.", priceMinor: 34900, capacity: 1200, maxPerOrder: 4 },
      { name: "Saturday Day Pass", description: "Saturday from 14:00 until close.", priceMinor: 8900, capacity: 3000 },
    ],
    experiences: [
      {
        slug: "sunset-sessions-pier",
        title: "Sunset Sessions on the Pier",
        description:
          "A 90-minute set at the very end of the North Pier as the sun drops into the sea. One small booth, one hundred and fifty guests, no phones on the rail.",
        category: "music",
        location: "North Pier",
        startsAt: "2027-07-10T19:30:00+03:00",
        endsAt: "2027-07-10T21:00:00+03:00",
        imageUrl: unsplash("photo-1696526290028-83653c91fb16"),
        imageCredit: credit("Caleb Bennetts"),
        inventory: { name: "Sunset Sessions · Saturday", priceMinor: 3000, capacity: 150, maxPerOrder: 2 },
      },
      {
        slug: "sunrise-dune-yoga",
        title: "Sunrise Yoga on the Dunes",
        description: "A slow, guided flow at first light on the East Dune Deck, followed by coffee and fruit from the beach kitchen.",
        category: "wellness",
        location: "East Dune Deck",
        startsAt: "2027-07-11T06:30:00+03:00",
        endsAt: "2027-07-11T07:45:00+03:00",
        imageUrl: unsplash("photo-1649874818787-d654d65a670f"),
        imageCredit: credit("Fito García"),
        inventory: { name: "Sunrise Yoga · Sunday", priceMinor: 1800, capacity: 80, maxPerOrder: 2 },
      },
      {
        slug: "producer-talk-backstage",
        title: "Backstage: From Sketch to Main Stage",
        description: "Two headline producers rebuild one of their tracks live from the first loop, then take questions from the room.",
        category: "talk",
        location: "Studio Tent",
        startsAt: "2027-07-10T15:00:00+03:00",
        endsAt: "2027-07-10T16:15:00+03:00",
        imageUrl: unsplash("photo-1470225620780-dba8ba36b745"),
        imageCredit: credit("Marcela Laskoski"),
        inventory: { name: "Producer Talk", priceMinor: 1500, capacity: 120, maxPerOrder: 4 },
      },
      {
        slug: "black-sea-chefs-table",
        title: "Chef's Table: Black Sea Kitchen",
        description: "Seven courses from the coast — smoked fish, dune herbs, fire-roasted vegetables — served at one long table under the lanterns.",
        category: "food",
        location: "Driftwood Pavilion",
        startsAt: "2027-07-09T20:00:00+03:00",
        endsAt: "2027-07-09T22:30:00+03:00",
        imageUrl: unsplash("photo-1750271328328-64ebf9c6e0b0"),
        imageCredit: credit("sidath vimukthi"),
        inventory: { name: "Chef's Table · Friday", priceMinor: 9500, capacity: 40, maxPerOrder: 2 },
      },
    ],
  },
  {
    organization: "tidal-assembly",
    slug: "blue-hour-jazz-nights-2027",
    title: "Blue Hour Jazz Nights",
    category: "concert",
    summary: "Two evenings of small-band jazz in a restored theatre in Sibiu's lower town.",
    description:
      "Blue Hour brings five ensembles to the Teatrul Mic stage over two nights: an opening trio, a vocal quartet, and a late set that runs as long as the room wants it to. Seated, intimate, and lit like a late-night record sleeve.",
    venueName: "Teatrul Mic",
    city: "Sibiu",
    countryCode: "RO",
    timeZone: "Europe/Bucharest",
    startsAt: "2027-06-18T19:00:00+03:00",
    endsAt: "2027-06-20T01:00:00+03:00",
    heroImageUrl: unsplash("photo-1776477073641-783c11379be7"),
    heroImageCredit: credit("Ted Vardalos"),
    admissions: [
      { name: "Two-Night Pass", description: "Reserved seating both evenings.", priceMinor: 7000, capacity: 400, maxPerOrder: 4 },
      { name: "Friday Only", priceMinor: 4000, capacity: 300, maxPerOrder: 4 },
    ],
    experiences: [
      {
        slug: "late-set-trumpet-trio",
        title: "Late Set: Trumpet & Trio",
        description: "After the main programme, sixty seats stay for an unannounced late set in the theatre bar.",
        category: "music",
        location: "Theatre Bar",
        startsAt: "2027-06-19T23:15:00+03:00",
        endsAt: "2027-06-20T00:45:00+03:00",
        imageUrl: unsplash("photo-1511192336575-5a79af67a629"),
        imageCredit: credit("Chris Bair"),
        inventory: { name: "Late Set · Saturday", priceMinor: 2200, capacity: 60, maxPerOrder: 2 },
      },
    ],
  },
  {
    organization: "tidal-assembly",
    slug: "afterglow-rooftop-sessions-2027",
    title: "Afterglow Rooftop Sessions",
    category: "club",
    summary: "House and disco on a rooftop above Bucharest, from golden hour to two in the morning.",
    description:
      "Afterglow takes over the top floor of a former printing house for one long summer evening. Warm-up selectors from 18:00, a headline set at dusk, and the city lights for the rest of the night.",
    venueName: "Tipografia Roof",
    city: "Bucharest",
    countryCode: "RO",
    timeZone: "Europe/Bucharest",
    startsAt: "2027-08-21T18:00:00+03:00",
    endsAt: "2027-08-22T02:00:00+03:00",
    heroImageUrl: unsplash("photo-1758272133693-d2124dbe00de"),
    heroImageCredit: credit("Vitaly Gariev"),
    admissions: [
      { name: "Rooftop Entry", priceMinor: 4500, capacity: 600, maxPerOrder: 6 },
      { name: "Terrace Table for Four", description: "A reserved table on the west terrace for four guests.", priceMinor: 26000, capacity: 20, maxPerOrder: 1 },
    ],
    experiences: [
      {
        slug: "golden-hour-aperitivo",
        title: "Golden Hour Aperitivo",
        description: "Early entry at 17:30 with a spritz flight on the west terrace before the doors open.",
        category: "food",
        location: "West Terrace",
        startsAt: "2027-08-21T18:00:00+03:00",
        endsAt: "2027-08-21T19:30:00+03:00",
        imageUrl: unsplash("photo-1485872299829-c673f5194813"),
        imageCredit: credit("Michael Discenza"),
        inventory: { name: "Aperitivo · Saturday", priceMinor: 2500, capacity: 80, maxPerOrder: 4 },
      },
    ],
  },
  {
    organization: "northlight-live",
    slug: "echo-valley-sessions-2027",
    title: "Echo Valley Sessions",
    category: "festival",
    summary: "A weekend of live bands and long dinners in a Transylvanian valley.",
    description:
      "Six bands, two nights, one valley outside Cluj. Camping and cabins on site, a single stage facing the ridge, and dinners served at long tables between sets.",
    venueName: "Echo Valley Farm",
    city: "Cluj-Napoca",
    countryCode: "RO",
    timeZone: "Europe/Bucharest",
    startsAt: "2027-09-03T16:00:00+03:00",
    endsAt: "2027-09-05T23:00:00+03:00",
    heroImageUrl: unsplash("photo-1598148678545-d4c563da3d0a"),
    heroImageCredit: credit("Liang Gao"),
    admissions: [{ name: "Weekend Pass", description: "Both days, camping included.", priceMinor: 12900, capacity: 2500 }],
    experiences: [
      {
        slug: "valley-ridge-hike",
        title: "Ridge Hike at Golden Hour",
        description: "A guided two-hour walk up to the ridge above the valley, back in time for the headline set.",
        category: "outdoors",
        location: "Trailhead Gate",
        startsAt: "2027-09-04T17:00:00+03:00",
        endsAt: "2027-09-04T19:00:00+03:00",
        imageUrl: unsplash("photo-1786476126300-18f4a30df025"),
        imageCredit: credit("Josh"),
        inventory: { name: "Ridge Hike", priceMinor: 2000, capacity: 60, maxPerOrder: 4 },
      },
    ],
  },
  {
    organization: "northlight-live",
    slug: "lumen-nights-winter-2027",
    title: "Lumen Nights: Winter Edition",
    category: "culture",
    summary: "Light installations and late-night sets across Brașov's old town.",
    description:
      "Twelve light installations by international artists across the squares and courtyards of the old town, with three venues hosting late-night sets. One wristband opens everything.",
    venueName: "Old Town Circuit",
    city: "Brașov",
    countryCode: "RO",
    timeZone: "Europe/Bucharest",
    startsAt: "2027-02-12T18:00:00+02:00",
    endsAt: "2027-02-14T02:00:00+02:00",
    heroImageUrl: unsplash("photo-1769897781930-2055fce6ea91"),
    heroImageCredit: credit("Stefan Szankowski"),
    admissions: [{ name: "Festival Wristband", priceMinor: 7500, capacity: 4000 }],
    experiences: [],
  },
  {
    organization: "northlight-live",
    slug: "signal-noise-weekender-2027",
    title: "Signal/Noise Weekender",
    category: "club",
    summary: "Forty-eight hours of techno and live electronics in a converted tram depot.",
    description:
      "Signal/Noise fills the old Timișoara tram depot with two rooms, a long light tunnel and a sound system tuned for the space. Live sets on Friday, DJs through Saturday night, a modular workshop on Sunday afternoon.",
    venueName: "Depoul de Tramvaie",
    city: "Timișoara",
    countryCode: "RO",
    timeZone: "Europe/Bucharest",
    startsAt: "2027-10-15T21:00:00+03:00",
    endsAt: "2027-10-17T21:00:00+03:00",
    heroImageUrl: unsplash("photo-1566737236500-c8ac43014a67"),
    heroImageCredit: credit("Aleksandr Popov"),
    admissions: [
      { name: "Weekender Pass", priceMinor: 9500, capacity: 3500 },
      { name: "Saturday Night", priceMinor: 5500, capacity: 1500 },
    ],
    experiences: [
      {
        slug: "modular-synth-workshop",
        title: "Modular Synth Workshop",
        description: "Two hours at a shared modular rack with the Friday live acts. Patch cables provided, no experience needed.",
        category: "workshop",
        location: "Room B",
        startsAt: "2027-10-17T15:00:00+03:00",
        endsAt: "2027-10-17T17:00:00+03:00",
        imageUrl: unsplash("photo-1594623930572-300a3011d9ae"),
        imageCredit: credit("Aleksandr Popov"),
        inventory: { name: "Modular Workshop", priceMinor: 3500, capacity: 24, maxPerOrder: 2 },
      },
    ],
  },
];

/** Editorial imagery that is not tied to a single record (homepage atmosphere). */
export const ambientImagery = [
  { url: unsplash("photo-1470229722913-7c0e2dbbafd3"), credit: credit("Yvette de Wit") },
  { url: unsplash("photo-1603910234616-3b5f4a6be2b4"), credit: credit("Samuel Regan-Asante") },
];
