# Visual assets

All photography is from [Unsplash](https://unsplash.com) under the [Unsplash License](https://unsplash.com/license):
free for commercial and non-commercial use, no permission needed, attribution not required (we credit anyway).
Only images on `images.unsplash.com` found with the `license=free` filter were used; no Unsplash+ (paid) images.

Images are not stored in the repository. They are referenced by URL (`events.hero_image_url`,
`experiences.image_url`) and resized by Unsplash's imgix CDN through `src/components/media/image-loader.ts`, so each
device downloads only the width it renders (AVIF/WebP via `auto=format`). Credits are stored next to each URL
(`*_image_credit`) and shown on the image or beneath the hero.

None of the photos show identifiable brands or real festival names; event names, venues and organisers are fictional.
A stage photo with visible branding on its screens was deliberately rejected.

| Used for | Photographer | Unsplash page |
| --- | --- | --- |
| Halcyon Shore 2027 (hero, featured) | Aleksei Zhivilov | https://unsplash.com/photos/a-group-of-people-sitting-on-top-of-a-sandy-beach-iDl6emO8Cz0 |
| Sunset Sessions on the Pier | Caleb Bennetts | https://unsplash.com/photos/a-pier-at-the-beach-with-a-light-house-in-the-background-hwAFSm2AboI |
| Sunrise Yoga on the Dunes | Fito García | https://unsplash.com/photos/a-woman-standing-on-top-of-a-beach-next-to-the-ocean-smxwhZFU7-w |
| Backstage: From Sketch to Main Stage | Marcela Laskoski | https://unsplash.com/photos/selective-focus-silhouette-photography-of-man-playing-red-lighted-dj-terminal-YrtFlrLo2DQ |
| Chef's Table: Black Sea Kitchen | sidath vimukthi | https://unsplash.com/photos/grilled-sausages-sit-on-a-dinner-table-at-night-HNjDcK8b6Vw |
| Blue Hour Jazz Nights (hero) | Ted Vardalos | https://unsplash.com/photos/musicians-performing-on-a-stage-with-instruments-ZrEK0SOYIn4 |
| Late Set: Trumpet & Trio | Chris Bair | https://unsplash.com/photos/person-playing-trumpet-during-night-time-A10y2Eq7OHY |
| Afterglow Rooftop Sessions (hero) | Vitaly Gariev | https://unsplash.com/photos/friends-celebrating-on-a-rooftop-party-with-city-view-M9ozCAVRLKo |
| Golden Hour Aperitivo | Michael Discenza | https://unsplash.com/photos/two-women-talking-while-holding-drinking-glasses-MxfcoxycH_Y |
| Echo Valley Sessions (hero) | Liang Gao | https://unsplash.com/photos/green-grass-field-and-trees-during-daytime-_HeZa8rehl0 |
| Ridge Hike at Golden Hour | Josh | https://unsplash.com/photos/person-on-rocky-cliff-overlooking-valley-UC3yOcEJ8NA |
| Lumen Nights: Winter Edition (hero) | Stefan Szankowski | https://unsplash.com/photos/people-gathered-around-a-glowing-blue-art-installation-at-night-bql_ixLkqcY |
| Signal/Noise Weekender (hero) | Aleksandr Popov | https://unsplash.com/photos/a-group-of-people-standing-around-in-a-room-9vDdkxSCAD4 |
| Modular Synth Workshop | Aleksandr Popov | https://unsplash.com/photos/black-and-blue-audio-mixer-JhYnL-BiP18 |
| Sign-in / sign-up panel | Yvette de Wit | https://unsplash.com/photos/stage-light-front-of-audience-NYrVisodQ2M |
| Reserve (ambient, unused in UI today) | Samuel Regan-Asante | https://unsplash.com/photos/concert-crowd-with-purple-confetti-3BcNKoySAq0 |

Fonts: Space Grotesk, Geist and Geist Mono via `next/font/google` (SIL Open Font License), self-hosted at build time.

Risk: hotlinked images depend on Unsplash availability (see security R-17). Production would copy approved images
to our own storage/CDN with the credit metadata.
