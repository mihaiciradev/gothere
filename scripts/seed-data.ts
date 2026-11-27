/**
 * Fictional demonstration ecosystem. All names, venues and people are invented.
 * Email domains use the reserved .test TLD so they can never reach a real inbox.
 * Historical orders and demand signals are added by later milestone seeds through the real services.
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
  {
    slug: "northlight-live",
    name: "Northlight Live",
    members: [{ user: "sam", role: "owner" }],
  },
];

type SeedInventory = {
  name: string;
  description?: string;
  priceMinor: number;
  capacity: number;
  maxPerOrder?: number;
};

export type SeedExperience = {
  slug: string;
  title: string;
  description: string;
  category: string;
  location: string;
  startsAt: string;
  endsAt: string;
  inventory: SeedInventory;
};

export type SeedEvent = {
  organization: string;
  slug: string;
  title: string;
  summary: string;
  description: string;
  venueName: string;
  city: string;
  countryCode: string;
  timeZone: string;
  startsAt: string;
  endsAt: string;
  admissions: SeedInventory[];
  experiences: SeedExperience[];
};

export const seedEvents: SeedEvent[] = [
  {
    organization: "tidal-assembly",
    slug: "halcyon-shore-2027",
    title: "Halcyon Shore 2027",
    summary: "Three days of electronic music, sea air and sunrise sets on the Black Sea coast.",
    description:
      "Halcyon Shore returns to the dunes for its fifth edition: four stages, a pier built for sunset sessions and a programme of small-format experiences designed to be booked alongside your pass.",
    venueName: "Saltmarsh Dunes",
    city: "Constanța",
    countryCode: "RO",
    timeZone: "Europe/Bucharest",
    startsAt: "2027-07-09T14:00:00+03:00",
    endsAt: "2027-07-12T06:00:00+03:00",
    admissions: [
      { name: "3-Day General Admission", priceMinor: 18900, capacity: 12000 },
      { name: "3-Day VIP", description: "Dedicated entrance, terrace and lockers.", priceMinor: 34900, capacity: 1200, maxPerOrder: 4 },
      { name: "Saturday Day Pass", priceMinor: 8900, capacity: 3000 },
    ],
    experiences: [
      {
        slug: "sunset-sessions-pier",
        title: "Sunset Sessions on the Pier",
        description: "An intimate 90-minute set at the end of the pier as the sun goes down. Limited to 150 guests.",
        category: "music",
        location: "North Pier",
        startsAt: "2027-07-10T19:30:00+03:00",
        endsAt: "2027-07-10T21:00:00+03:00",
        inventory: { name: "Sunset Sessions · Saturday", priceMinor: 3000, capacity: 150, maxPerOrder: 2 },
      },
      {
        slug: "sunrise-dune-yoga",
        title: "Sunrise Yoga on the Dunes",
        description: "A guided flow at first light, followed by coffee from the beach kitchen.",
        category: "wellness",
        location: "East Dune Deck",
        startsAt: "2027-07-11T06:30:00+03:00",
        endsAt: "2027-07-11T07:45:00+03:00",
        inventory: { name: "Sunrise Yoga · Sunday", priceMinor: 1800, capacity: 80, maxPerOrder: 2 },
      },
      {
        slug: "producer-talk-backstage",
        title: "Backstage: From Sketch to Main Stage",
        description: "Two headline producers break down a track live, then take questions.",
        category: "talk",
        location: "Studio Tent",
        startsAt: "2027-07-10T15:00:00+03:00",
        endsAt: "2027-07-10T16:15:00+03:00",
        inventory: { name: "Producer Talk", priceMinor: 1500, capacity: 120, maxPerOrder: 4 },
      },
      {
        slug: "black-sea-chefs-table",
        title: "Chef's Table: Black Sea Kitchen",
        description: "A seven-course tasting menu from the coast, served at one long table.",
        category: "food",
        location: "Driftwood Pavilion",
        startsAt: "2027-07-09T20:00:00+03:00",
        endsAt: "2027-07-09T22:30:00+03:00",
        inventory: { name: "Chef's Table · Friday", priceMinor: 9500, capacity: 40, maxPerOrder: 2 },
      },
    ],
  },
  {
    organization: "northlight-live",
    slug: "echo-valley-sessions-2027",
    title: "Echo Valley Sessions",
    summary: "A weekend of live bands and long dinners in a Transylvanian valley.",
    description: "Six bands, two nights, one valley. Camping and cabins on site.",
    venueName: "Echo Valley Farm",
    city: "Cluj-Napoca",
    countryCode: "RO",
    timeZone: "Europe/Bucharest",
    startsAt: "2027-09-03T16:00:00+03:00",
    endsAt: "2027-09-05T23:00:00+03:00",
    admissions: [{ name: "Weekend Pass", priceMinor: 12900, capacity: 2500 }],
    experiences: [
      {
        slug: "valley-ridge-hike",
        title: "Ridge Hike at Golden Hour",
        description: "A guided two-hour walk above the valley before the headline set.",
        category: "outdoors",
        location: "Trailhead Gate",
        startsAt: "2027-09-04T17:00:00+03:00",
        endsAt: "2027-09-04T19:00:00+03:00",
        inventory: { name: "Ridge Hike", priceMinor: 2000, capacity: 60, maxPerOrder: 4 },
      },
    ],
  },
  {
    organization: "northlight-live",
    slug: "lumen-nights-winter-2027",
    title: "Lumen Nights: Winter Edition",
    summary: "Light installations and late-night sets across Brașov's old town.",
    description: "Twelve installations, three venues and a single wristband.",
    venueName: "Old Town Circuit",
    city: "Brașov",
    countryCode: "RO",
    timeZone: "Europe/Bucharest",
    startsAt: "2027-02-12T18:00:00+02:00",
    endsAt: "2027-02-14T02:00:00+02:00",
    admissions: [{ name: "Festival Wristband", priceMinor: 7500, capacity: 4000 }],
    experiences: [],
  },
];
