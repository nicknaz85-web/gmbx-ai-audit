// seed.js — reference data (neighborhoods + venues with historical baselines)
// and a backfill of the last ~90 minutes of anonymous signals so the radar
// feels alive the instant the app opens, before any real user interaction.

import { db } from './store.js';
import {
  now, MIN, anonHash, seededRand, nightHour, dayOfWeek, nightCurve, randId,
} from './util.js';
import { formatMoney } from './money.js';
import { RESOLVED } from './resolved.js'; // real Google coords baked in (accurate pins)
import { BAKED_PLACES } from './baked-places.js'; // real ratings + reviews + descriptions
import { BAKED_INSTAGRAM } from './baked-instagram.js'; // resolved Instagram profile URLs
import { BAKED_HOURS } from './baked-hours.js'; // real weekly opening-hours schedules
import { BAKED_PHOTOS } from './baked-photos.js'; // first Google photo per venue (keyless URL)
import { KIND_OVERRIDES } from './baked-kinds.js'; // kind/category corrections verified vs Google primaryType
import { cityTz } from './hours.js'; // per-city UTC offset so night curves read local time

// Athens nightlife districts. `center` drives the stylized map projection and
// the 400m cluster/proximity maths; the model is city-agnostic — add rows for
// Shoreditch, Kreuzberg, De Pijp… and everything else scales unchanged.
const NEIGHBORHOODS = [
  { id: 'gazi',        name: 'Gazi',        city: 'Athens', center: { lat: 37.9781, lng: 23.7106 }, radius: 320, bestFor: ['Dancing', 'Late Night'] },
  { id: 'psyrri',      name: 'Psyrri',      city: 'Athens', center: { lat: 37.9788, lng: 23.7252 }, radius: 300, bestFor: ['Bars', 'Dancing'] },
  { id: 'monastiraki', name: 'Monastiraki', city: 'Athens', center: { lat: 37.9762, lng: 23.7258 }, radius: 280, bestFor: ['Rooftops', 'Bars'] },
  { id: 'kolonaki',    name: 'Kolonaki',    city: 'Athens', center: { lat: 37.9795, lng: 23.7440 }, radius: 300, bestFor: ['Cocktails', 'Upscale'] },
  { id: 'exarcheia',   name: 'Exarcheia',   city: 'Athens', center: { lat: 37.9861, lng: 23.7335 }, radius: 300, bestFor: ['Live', 'Late Night'] },
  { id: 'koukaki',     name: 'Koukaki',     city: 'Athens', center: { lat: 37.9662, lng: 23.7256 }, radius: 280, bestFor: ['Bars', 'Wine'] },

  // THESSALONIKI
  { id: 'valaoritou',   name: 'Valaoritou',   city: 'Thessaloniki', center: { lat: 40.6362, lng: 22.9378 }, radius: 260, bestFor: ['Bars', 'Dancing'] },
  { id: 'ladadika',     name: 'Ladadika',     city: 'Thessaloniki', center: { lat: 40.6399, lng: 22.9360 }, radius: 240, bestFor: ['Bars', 'Late Night'] },
  // MYKONOS
  { id: 'mykonos-town', name: 'Mykonos Town', city: 'Mykonos',      center: { lat: 37.4457, lng: 25.3270 }, radius: 340, bestFor: ['Cocktails', 'Dancing'] },
  // SANTORINI
  { id: 'fira',         name: 'Fira',         city: 'Santorini',    center: { lat: 36.4165, lng: 25.4318 }, radius: 300, bestFor: ['Cocktails', 'Sunset'] },
  // CRETE
  { id: 'chandakos',    name: 'Chandakos',    city: 'Heraklion',    center: { lat: 35.3402, lng: 25.1335 }, radius: 260, bestFor: ['Bars', 'Live'] },
  { id: 'chania-old',   name: 'Old Harbour',  city: 'Chania',       center: { lat: 35.5175, lng: 24.0185 }, radius: 280, bestFor: ['Bars', 'Wine'] },
  // PATRAS
  { id: 'riga',         name: 'Riga Feraiou', city: 'Patras',       center: { lat: 38.2464, lng: 21.7348 }, radius: 260, bestFor: ['Bars', 'Late Night'] },
  // RHODES
  { id: 'rhodes-old',   name: 'Old Town',     city: 'Rhodes',       center: { lat: 36.4442, lng: 28.2268 }, radius: 280, bestFor: ['Bars', 'Rooftops'] },
  // CORFU
  { id: 'corfu-town',   name: 'Corfu Town',   city: 'Corfu',        center: { lat: 39.6243, lng: 19.9212 }, radius: 280, bestFor: ['Dancing', 'Bars'] },
  { id: 'nafplio-old',  name: 'Old Town',     city: 'Nafplio',      center: { lat: 37.5680, lng: 22.7980 }, radius: 260, bestFor: ['Cocktails', 'Bars'] },
  // PARTY / HOLIDAY RESORTS
  { id: 'albufeira-strip', name: 'The Strip',  city: 'Albufeira',    center: { lat: 37.0890, lng: -8.2510 }, radius: 320, bestFor: ['Dancing', 'Bars'] },
  { id: 'laganas',      name: 'Laganas Strip', city: 'Zakynthos',   center: { lat: 37.7250, lng: 20.8600 }, radius: 360, bestFor: ['Dancing', 'Bars'] },
  { id: 'magaluf-strip', name: 'Punta Ballena', city: 'Magaluf',    center: { lat: 39.5100, lng: 2.5330 },  radius: 340, bestFor: ['Dancing', 'Bars'] },
  { id: 'malia-strip',  name: 'The Strip',     city: 'Malia',        center: { lat: 35.2870, lng: 25.4600 }, radius: 320, bestFor: ['Dancing', 'Bars'] },
  { id: 'ayianapa',     name: 'Ayia Napa',     city: 'Ayia Napa',    center: { lat: 34.9880, lng: 33.9990 }, radius: 380, bestFor: ['Dancing', 'Bars'] },
  { id: 'sunnybeach',   name: 'Sunny Beach',   city: 'Sunny Beach',  center: { lat: 42.6900, lng: 27.7130 }, radius: 420, bestFor: ['Dancing', 'Bars'] },

  // GERMANY
  { id: 'friedrichshain', name: 'Friedrichshain', city: 'Berlin',  center: { lat: 52.5105, lng: 13.4490 }, radius: 420, bestFor: ['Techno', 'Late Night'] },
  { id: 'kreuzberg',      name: 'Kreuzberg',      city: 'Berlin',  center: { lat: 52.4995, lng: 13.4230 }, radius: 420, bestFor: ['Techno', 'Dancing'] },
  { id: 'sonnenstrasse',  name: 'Sonnenstraße',   city: 'Munich',  center: { lat: 48.1345, lng: 11.5650 }, radius: 340, bestFor: ['Dancing', 'Techno'] },
  // ITALY
  { id: 'navigli',        name: 'Navigli',        city: 'Milan',   center: { lat: 45.4520, lng: 9.1760 },  radius: 420, bestFor: ['Dancing', 'Bars'] },
  { id: 'ostiense',       name: 'Ostiense',       city: 'Rome',    center: { lat: 41.8620, lng: 12.4790 }, radius: 420, bestFor: ['Dancing', 'Late Night'] },
  // FRANCE
  { id: 'oberkampf',      name: 'Oberkampf',      city: 'Paris',   center: { lat: 48.8660, lng: 2.3775 },  radius: 360, bestFor: ['Dancing', 'Bars'] },
  { id: 'pigalle',        name: 'Pigalle',        city: 'Paris',   center: { lat: 48.8820, lng: 2.3370 },  radius: 320, bestFor: ['Dancing', 'Live'] },

  // SERBIA
  { id: 'savamala',      name: 'Savamala',   city: 'Belgrade',  center: { lat: 44.8125, lng: 20.4510 }, radius: 460, bestFor: ['Techno', 'Late Night'] },
  // SPAIN
  { id: 'madrid-centro', name: 'Centro',     city: 'Madrid',    center: { lat: 40.4180, lng: -3.7020 }, radius: 420, bestFor: ['Dancing', 'Late Night'] },
  { id: 'poblenou',      name: 'Poblenou',   city: 'Barcelona', center: { lat: 41.3980, lng: 2.1950 },  radius: 460, bestFor: ['Dancing', 'Late Night'] },
  { id: 'ibiza',         name: 'Ibiza',      city: 'Ibiza',     center: { lat: 38.9070, lng: 1.4200 },  radius: 700, bestFor: ['Dancing', 'Late Night'] },

  // MONTENEGRO
  { id: 'budva',           name: 'Budva',      city: 'Budva',     center: { lat: 42.2864, lng: 18.8400 }, radius: 520, bestFor: ['Dancing', 'Late Night'] },
  // BOSNIA
  { id: 'sarajevo-centar', name: 'Centar',     city: 'Sarajevo',  center: { lat: 43.8580, lng: 18.4210 }, radius: 440, bestFor: ['Dancing', 'Bars'] },
  // CROATIA
  { id: 'zrce',            name: 'Zrće Beach', city: 'Novalja',   center: { lat: 44.5430, lng: 14.9040 }, radius: 520, bestFor: ['Dancing', 'Beach'] },
  { id: 'hvar',            name: 'Hvar',       city: 'Hvar',      center: { lat: 43.1729, lng: 16.4410 }, radius: 420, bestFor: ['Dancing', 'Cocktails'] },
  // KOSOVO
  { id: 'pristina',        name: 'Pristina',   city: 'Pristina',  center: { lat: 42.6629, lng: 21.1655 }, radius: 440, bestFor: ['Dancing', 'Bars'] },
  // ALBANIA
  { id: 'blloku',          name: 'Blloku',     city: 'Tirana',    center: { lat: 41.3200, lng: 19.8180 }, radius: 420, bestFor: ['Dancing', 'Rooftops'] },

  // HUNGARY — Budapest (District VII ruin-bar & club quarter)
  { id: 'erzsebetvaros',   name: 'Erzsébetváros', city: 'Budapest',  center: { lat: 47.4979, lng: 19.0637 }, radius: 460, bestFor: ['Ruin Bars', 'Dancing'] },
  // CZECHIA — Prague
  { id: 'stare-mesto-prg', name: 'Staré Město',   city: 'Prague',    center: { lat: 50.0875, lng: 14.4210 }, radius: 460, bestFor: ['Dancing', 'Late Night'] },
  // SLOVAKIA — Bratislava
  { id: 'stare-mesto-ba',  name: 'Staré Mesto',   city: 'Bratislava', center: { lat: 48.1440, lng: 17.1050 }, radius: 400, bestFor: ['Dancing', 'Bars'] },
  // ROMANIA — Bucharest (Lipscani old town)
  { id: 'lipscani',        name: 'Old Town',      city: 'Bucharest', center: { lat: 44.4310, lng: 26.1010 }, radius: 480, bestFor: ['Dancing', 'Late Night'] },
  // POLAND — Warsaw & Kraków
  { id: 'srodmiescie',     name: 'Śródmieście',   city: 'Warsaw',    center: { lat: 52.2300, lng: 21.0180 }, radius: 500, bestFor: ['Techno', 'Late Night'] },
  { id: 'krakow-stare',    name: 'Stare Miasto',  city: 'Kraków',    center: { lat: 50.0615, lng: 19.9370 }, radius: 440, bestFor: ['Dancing', 'Bars'] },
  { id: 'poznan-centrum',  name: 'Centrum',       city: 'Poznań',    center: { lat: 52.4064, lng: 16.9252 }, radius: 420, bestFor: ['Techno', 'Dancing'] },
  // MOLDOVA — Chișinău
  { id: 'chisinau-centru', name: 'Centru',        city: 'Chișinău',  center: { lat: 47.0245, lng: 28.8320 }, radius: 440, bestFor: ['Dancing', 'Bars'] },

  // ROMANIA — Mamaia (Black Sea summer resort strip)
  { id: 'mamaia',          name: 'Mamaia',        city: 'Mamaia',    center: { lat: 44.2560, lng: 28.6180 }, radius: 900, bestFor: ['Beach', 'Dancing'] },
  // POLAND — Sopot (Baltic summer resort)
  { id: 'sopot',           name: 'Sopot',         city: 'Sopot',     center: { lat: 54.4416, lng: 18.5601 }, radius: 650, bestFor: ['Beach', 'Dancing'] },

  // GERMANY — more cities
  { id: 'hamburg-stpauli', name: 'St. Pauli',     city: 'Hamburg',   center: { lat: 53.5497, lng: 9.9636 },  radius: 420, bestFor: ['Techno', 'Late Night'] },
  { id: 'cologne-city',    name: 'Cologne',       city: 'Cologne',   center: { lat: 50.9384, lng: 6.9860 },  radius: 460, bestFor: ['Techno', 'Dancing'] },
  { id: 'frankfurt-city',  name: 'Frankfurt',     city: 'Frankfurt', center: { lat: 50.1050, lng: 8.6900 },  radius: 460, bestFor: ['Techno', 'Dancing'] },
  { id: 'leipzig-city',    name: 'Leipzig',       city: 'Leipzig',   center: { lat: 51.3320, lng: 12.3700 }, radius: 460, bestFor: ['Techno', 'Late Night'] },
  // FRANCE — more cities
  { id: 'lyon',            name: 'Lyon',          city: 'Lyon',      center: { lat: 45.7420, lng: 4.8180 },  radius: 460, bestFor: ['Dancing', 'Late Night'] },
  { id: 'marseille',       name: 'Marseille',     city: 'Marseille', center: { lat: 43.2950, lng: 5.3690 },  radius: 460, bestFor: ['Dancing', 'Rooftops'] },
  { id: 'nice',            name: 'Nice',          city: 'Nice',      center: { lat: 43.6970, lng: 7.2710 },  radius: 380, bestFor: ['Dancing', 'Late Night'] },
  // BELGIUM
  { id: 'brussels',        name: 'Brussels',      city: 'Brussels',  center: { lat: 50.8390, lng: 4.3460 },  radius: 480, bestFor: ['Techno', 'Late Night'] },
  { id: 'antwerp',         name: 'Antwerp',       city: 'Antwerp',   center: { lat: 51.2200, lng: 4.4000 },  radius: 460, bestFor: ['Techno', 'Dancing'] },
  { id: 'ghent',           name: 'Ghent',         city: 'Ghent',     center: { lat: 51.0430, lng: 3.7100 },  radius: 480, bestFor: ['Techno', 'Dancing'] },
  // NETHERLANDS
  { id: 'amsterdam',       name: 'Amsterdam',     city: 'Amsterdam', center: { lat: 52.3600, lng: 4.9080 },  radius: 560, bestFor: ['Techno', 'Late Night'] },
  { id: 'rotterdam',       name: 'Rotterdam',     city: 'Rotterdam', center: { lat: 51.9050, lng: 4.4850 },  radius: 500, bestFor: ['Techno', 'Dancing'] },
  // SPAIN — more cities
  { id: 'valencia',        name: 'Valencia',      city: 'Valencia',  center: { lat: 39.4560, lng: -0.3520 }, radius: 500, bestFor: ['Dancing', 'Late Night'] },
  { id: 'seville',         name: 'Seville',       city: 'Seville',   center: { lat: 37.3820, lng: -5.9930 }, radius: 460, bestFor: ['Dancing', 'Bars'] },
  // PORTUGAL
  { id: 'lisbon',          name: 'Lisbon',        city: 'Lisbon',    center: { lat: 38.7130, lng: -9.1250 }, radius: 500, bestFor: ['Dancing', 'Late Night'] },
  { id: 'porto',           name: 'Porto',         city: 'Porto',     center: { lat: 41.1450, lng: -8.6110 }, radius: 460, bestFor: ['Dancing', 'Bars'] },

  // UNITED KINGDOM
  { id: 'central-london',  name: 'Central London',city: 'London',    center: { lat: 51.5120, lng: -0.1050 }, radius: 620, bestFor: ['Dancing', 'Late Night'] },
  { id: 'shoreditch',      name: 'Shoreditch',    city: 'London',    center: { lat: 51.5260, lng: -0.0790 }, radius: 520, bestFor: ['Dancing', 'Bars'] },
  { id: 'manchester',      name: 'Manchester',    city: 'Manchester',center: { lat: 53.4740, lng: -2.2360 }, radius: 560, bestFor: ['Techno', 'Late Night'] },
  { id: 'glasgow',         name: 'Glasgow',       city: 'Glasgow',   center: { lat: 55.8570, lng: -4.2590 }, radius: 500, bestFor: ['Techno', 'Dancing'] },
  { id: 'leeds',           name: 'Leeds',         city: 'Leeds',     center: { lat: 53.7950, lng: -1.5490 }, radius: 480, bestFor: ['Techno', 'Dancing'] },
  { id: 'birmingham',      name: 'Birmingham',    city: 'Birmingham',center: { lat: 52.4750, lng: -1.8850 }, radius: 500, bestFor: ['Dancing', 'Late Night'] },
  { id: 'liverpool',       name: 'Liverpool',     city: 'Liverpool', center: { lat: 53.4010, lng: -2.9770 }, radius: 480, bestFor: ['Dancing', 'Live'] },
  { id: 'bristol',         name: 'Bristol',       city: 'Bristol',   center: { lat: 51.4550, lng: -2.5900 }, radius: 480, bestFor: ['Techno', 'Late Night'] },
  { id: 'newcastle',       name: 'Newcastle',     city: 'Newcastle', center: { lat: 54.9700, lng: -1.6100 }, radius: 460, bestFor: ['Dancing', 'Late Night'] },
  { id: 'edinburgh',       name: 'Edinburgh',     city: 'Edinburgh', center: { lat: 55.9490, lng: -3.1880 }, radius: 460, bestFor: ['Dancing', 'Bars'] },
  { id: 'sheffield',       name: 'Sheffield',     city: 'Sheffield', center: { lat: 53.3830, lng: -1.4650 }, radius: 460, bestFor: ['Techno', 'Late Night'] },
  { id: 'cardiff',         name: 'Cardiff',       city: 'Cardiff',   center: { lat: 51.4810, lng: -3.1790 }, radius: 460, bestFor: ['Dancing', 'Live'] },
  { id: 'belfast',         name: 'Belfast',       city: 'Belfast',   center: { lat: 54.5970, lng: -5.9300 }, radius: 460, bestFor: ['Dancing', 'Late Night'] },

  // AUSTRIA
  { id: 'vienna',          name: 'Vienna',        city: 'Vienna',    center: { lat: 48.2100, lng: 16.3800 }, radius: 520, bestFor: ['Techno', 'Late Night'] },
  // SLOVENIA
  { id: 'ljubljana',       name: 'Ljubljana',     city: 'Ljubljana', center: { lat: 46.0530, lng: 14.5060 }, radius: 440, bestFor: ['Dancing', 'Late Night'] },
  // SWITZERLAND
  { id: 'zurich',          name: 'Zürich',        city: 'Zurich',    center: { lat: 47.3780, lng: 8.5300 },  radius: 480, bestFor: ['Techno', 'Late Night'] },
  { id: 'geneva',          name: 'Geneva',        city: 'Geneva',    center: { lat: 46.2044, lng: 6.1432 },  radius: 440, bestFor: ['Dancing', 'Late Night'] },

  // DENMARK
  { id: 'copenhagen',      name: 'Copenhagen',    city: 'Copenhagen', center: { lat: 55.6761, lng: 12.5683 }, radius: 500, bestFor: ['Techno', 'Late Night'] },
  // BULGARIA
  { id: 'sofia',           name: 'Sofia',         city: 'Sofia',      center: { lat: 42.6977, lng: 23.3219 }, radius: 480, bestFor: ['Dancing', 'Late Night'] },
  // SWEDEN
  { id: 'stockholm',       name: 'Stockholm',     city: 'Stockholm',  center: { lat: 59.3293, lng: 18.0686 }, radius: 520, bestFor: ['Techno', 'Late Night'] },
  // FINLAND
  { id: 'helsinki',        name: 'Helsinki',      city: 'Helsinki',   center: { lat: 60.1699, lng: 24.9384 }, radius: 480, bestFor: ['Techno', 'Late Night'] },
  // NORWAY
  { id: 'oslo',            name: 'Oslo',          city: 'Oslo',       center: { lat: 59.9139, lng: 10.7522 }, radius: 480, bestFor: ['Techno', 'Dancing'] },
  // IRELAND
  { id: 'dublin',          name: 'Dublin',        city: 'Dublin',     center: { lat: 53.3498, lng: -6.2603 }, radius: 480, bestFor: ['Dancing', 'Late Night'] },

  // ============ WORLDWIDE ============
  // NORTH AMERICA — USA
  { id: 'nyc-bk',      name: 'Brooklyn',       city: 'New York',     center: { lat: 40.7069, lng: -73.9235 }, radius: 520, bestFor: ['Techno', 'Dancing'] },
  { id: 'nyc-mnh',     name: 'Manhattan',      city: 'New York',     center: { lat: 40.7220, lng: -73.9880 }, radius: 520, bestFor: ['Dancing', 'Rooftops'] },
  { id: 'miami-beach', name: 'Miami Beach',    city: 'Miami',        center: { lat: 25.7907, lng: -80.1300 }, radius: 520, bestFor: ['Dancing', 'Late Night'] },
  { id: 'miami-dt',    name: 'Downtown Miami', city: 'Miami',        center: { lat: 25.7855, lng: -80.1940 }, radius: 500, bestFor: ['Techno', 'Late Night'] },
  { id: 'la-hollywood',name: 'Hollywood',      city: 'Los Angeles',  center: { lat: 34.0980, lng: -118.3260 }, radius: 520, bestFor: ['Dancing', 'Hip-Hop'] },
  { id: 'la-westwood', name: 'Westwood (UCLA)', city: 'Los Angeles',  center: { lat: 34.0633, lng: -118.4453 }, radius: 380, bestFor: ['Bars', 'Student'] },
  { id: 'la-usc',      name: 'USC / University Park', city: 'Los Angeles', center: { lat: 34.0224, lng: -118.2851 }, radius: 440, bestFor: ['Bars', 'Student'] },
  { id: 'la-downtown', name: 'Downtown LA',     city: 'Los Angeles',  center: { lat: 34.0430, lng: -118.2450 }, radius: 500, bestFor: ['Dancing', 'Late Night'] },
  { id: 'la-silverlake',name: 'Silver Lake',    city: 'Los Angeles',  center: { lat: 34.0869, lng: -118.2702 }, radius: 420, bestFor: ['Bars', 'Dancing'] },
  { id: 'nashville-broadway', name: 'Broadway', city: 'Nashville',    center: { lat: 36.1600, lng: -86.7780 }, radius: 460, bestFor: ['Live', 'Bars'] },
  { id: 'denver-lodo', name: 'LoDo',            city: 'Denver',       center: { lat: 39.7530, lng: -104.9990 }, radius: 460, bestFor: ['Dancing', 'Bars'] },
  { id: 'kc-downtown', name: 'Power & Light',   city: 'Kansas City',  center: { lat: 39.0997, lng: -94.5830 }, radius: 460, bestFor: ['Bars', 'Dancing'] },
  { id: 'stl-grove',   name: 'The Grove',       city: 'St. Louis',    center: { lat: 38.6270, lng: -90.2554 }, radius: 460, bestFor: ['Dancing', 'Bars'] },
  { id: 'mpls-downtown',name: 'Downtown',       city: 'Minneapolis',  center: { lat: 44.9800, lng: -93.2700 }, radius: 460, bestFor: ['Dancing', 'Live'] },
  { id: 'indy-massave',name: 'Mass Ave',        city: 'Indianapolis', center: { lat: 39.7770, lng: -86.1480 }, radius: 460, bestFor: ['Bars', 'Live'] },
  { id: 'columbus-shortnorth', name: 'Short North', city: 'Columbus', center: { lat: 39.9760, lng: -83.0030 }, radius: 460, bestFor: ['Bars', 'Dancing'] },
  { id: 'memphis-beale',name: 'Beale Street',   city: 'Memphis',      center: { lat: 35.1390, lng: -90.0520 }, radius: 440, bestFor: ['Live', 'Bars'] },
  { id: 'milwaukee-thirdward', name: 'Third Ward', city: 'Milwaukee', center: { lat: 43.0330, lng: -87.9060 }, radius: 460, bestFor: ['Bars', 'Dancing'] },
  { id: 'okc-bricktown',name: 'Bricktown',      city: 'Oklahoma City',center: { lat: 35.4640, lng: -97.5090 }, radius: 460, bestFor: ['Bars', 'Live'] },
  { id: 'slc-downtown',name: 'Downtown',        city: 'Salt Lake City',center: { lat: 40.7660, lng: -111.8910 }, radius: 460, bestFor: ['Bars', 'Dancing'] },
  { id: 'cincy-otr',   name: 'Over-the-Rhine',  city: 'Cincinnati',   center: { lat: 39.1150, lng: -84.5150 }, radius: 440, bestFor: ['Bars', 'Live'] },
  { id: 'phoenix-scottsdale', name: 'Old Town Scottsdale', city: 'Phoenix', center: { lat: 33.4940, lng: -111.9260 }, radius: 480, bestFor: ['Dancing', 'Late Night'] },
  { id: 'lv-strip',    name: 'The Strip',      city: 'Las Vegas',    center: { lat: 36.1147, lng: -115.1728 }, radius: 540, bestFor: ['Dancing', 'Commercial'] },
  { id: 'chicago',     name: 'River North',    city: 'Chicago',      center: { lat: 41.9000, lng: -87.6500 }, radius: 500, bestFor: ['House', 'Techno'] },
  // NORTH AMERICA — Canada
  { id: 'montreal',    name: 'Plateau',        city: 'Montreal',     center: { lat: 45.5170, lng: -73.5810 }, radius: 500, bestFor: ['Techno', 'Late Night'] },
  { id: 'toronto',     name: 'King West',      city: 'Toronto',      center: { lat: 43.6440, lng: -79.4000 }, radius: 500, bestFor: ['Dancing', 'Hip-Hop'] },
  // NORTH AMERICA — Mexico
  { id: 'cdmx-roma',   name: 'Roma Norte',     city: 'Mexico City',  center: { lat: 19.4190, lng: -99.1600 }, radius: 500, bestFor: ['House', 'Dancing'] },
  // CENTRAL AMERICA
  { id: 'cancun-zh',   name: 'Zona Hotelera',  city: 'Cancún',       center: { lat: 21.1330, lng: -86.7460 }, radius: 520, bestFor: ['Dancing', 'Commercial'] },
  { id: 'tulum',       name: 'Tulum Beach',    city: 'Tulum',        center: { lat: 20.1600, lng: -87.4650 }, radius: 520, bestFor: ['House', 'Late Night'] },
  { id: 'panama-casco',name: 'Casco Viejo',    city: 'Panama City',  center: { lat: 8.9510,  lng: -79.5340 }, radius: 480, bestFor: ['Dancing', 'Rooftops'] },
  { id: 'sanjose-cr',  name: 'San José',       city: 'San José',     center: { lat: 9.9330,  lng: -84.0790 }, radius: 480, bestFor: ['Dancing', 'Live'] },
  { id: 'guatemala-zv',name: 'Zona Viva',      city: 'Guatemala City', center: { lat: 14.5990, lng: -90.5130 }, radius: 480, bestFor: ['Dancing', 'Bars'] },
  { id: 'sansalvador-zr', name: 'Zona Rosa',   city: 'San Salvador', center: { lat: 13.7010, lng: -89.2240 }, radius: 480, bestFor: ['Dancing', 'Live'] },
  // SOUTH AMERICA
  { id: 'sao-paulo',   name: 'Barra Funda',    city: 'São Paulo',    center: { lat: -23.5250, lng: -46.6660 }, radius: 520, bestFor: ['Techno', 'House'] },
  { id: 'rio-lapa',    name: 'Lapa',           city: 'Rio de Janeiro', center: { lat: -22.9130, lng: -43.1790 }, radius: 500, bestFor: ['Live', 'Dancing'] },
  { id: 'ba-palermo',  name: 'Palermo',        city: 'Buenos Aires', center: { lat: -34.5880, lng: -58.4300 }, radius: 520, bestFor: ['Techno', 'Dancing'] },
  { id: 'bogota-chap', name: 'Chapinero',      city: 'Bogotá',       center: { lat: 4.6480,  lng: -74.0620 }, radius: 500, bestFor: ['Dancing', 'Latin'] },
  { id: 'medellin-pob',name: 'El Poblado',     city: 'Medellín',     center: { lat: 6.2090,  lng: -75.5700 }, radius: 500, bestFor: ['Latin', 'Dancing'] },
  { id: 'lima-barranco',name: 'Barranco',      city: 'Lima',         center: { lat: -12.1490, lng: -77.0210 }, radius: 480, bestFor: ['Dancing', 'Live'] },
  { id: 'santiago-bel',name: 'Bellavista',     city: 'Santiago',     center: { lat: -33.4330, lng: -70.6350 }, radius: 500, bestFor: ['Techno', 'Dancing'] },
  // ASIA
  { id: 'bangkok-sukh',name: 'Sukhumvit',      city: 'Bangkok',      center: { lat: 13.7400, lng: 100.5600 }, radius: 520, bestFor: ['Dancing', 'Late Night'] },
  { id: 'phuket-bangla',name: 'Bangla Road',   city: 'Phuket',       center: { lat: 7.8930,  lng: 98.2966 },  radius: 420, bestFor: ['Dancing', 'Late Night'] },
  { id: 'samui-chaweng',name: 'Chaweng Beach', city: 'Koh Samui',    center: { lat: 9.5333,  lng: 100.0620 }, radius: 460, bestFor: ['Dancing', 'Beach'] },
  { id: 'phangan-haadrin',name: 'Haad Rin',    city: 'Koh Phangan',  center: { lat: 9.6790,  lng: 100.0680 }, radius: 440, bestFor: ['Beach', 'Late Night'] },
  { id: 'kohtao-sairee',name: 'Sairee Beach',  city: 'Koh Tao',      center: { lat: 10.0977, lng: 99.8339 },  radius: 420, bestFor: ['Beach', 'Bars'] },
  { id: 'krabi-aonang', name: 'Ao Nang',        city: 'Krabi',        center: { lat: 8.0330,  lng: 98.8230 },  radius: 440, bestFor: ['Beach', 'Bars'] },
  { id: 'phiphi-tonsai',name: 'Tonsai / Loh Dalum', city: 'Koh Phi Phi', center: { lat: 7.7407, lng: 98.7784 }, radius: 380, bestFor: ['Beach', 'Late Night'] },
  { id: 'tokyo-shibuya',name: 'Shibuya',       city: 'Tokyo',        center: { lat: 35.6580, lng: 139.6980 }, radius: 520, bestFor: ['Techno', 'House'] },
  { id: 'tokyo-roppongi',name: 'Roppongi',     city: 'Tokyo',        center: { lat: 35.6640, lng: 139.7310 }, radius: 500, bestFor: ['Dancing', 'Hip-Hop'] },
  { id: 'osaka-namba', name: 'Namba',          city: 'Osaka',        center: { lat: 34.6690, lng: 135.5010 }, radius: 500, bestFor: ['Dancing', 'Techno'] },
  { id: 'seoul-itaewon',name: 'Itaewon',       city: 'Seoul',        center: { lat: 37.5340, lng: 126.9940 }, radius: 500, bestFor: ['House', 'Hip-Hop'] },
  { id: 'seoul-gangnam',name: 'Gangnam',       city: 'Seoul',        center: { lat: 37.4980, lng: 127.0276 }, radius: 500, bestFor: ['Dancing', 'Commercial'] },
  { id: 'hcmc-d1',     name: 'District 1',     city: 'Ho Chi Minh City', center: { lat: 10.7770, lng: 106.7010 }, radius: 500, bestFor: ['Dancing', 'Late Night'] },
  { id: 'hanoi-oq',    name: 'Old Quarter',    city: 'Hanoi',        center: { lat: 21.0340, lng: 105.8510 }, radius: 480, bestFor: ['Dancing', 'Live'] },
  { id: 'bali-seminyak',name: 'Seminyak',      city: 'Bali',         center: { lat: -8.6900, lng: 115.1650 }, radius: 520, bestFor: ['House', 'Dancing'] },
  { id: 'bali-canggu', name: 'Canggu',         city: 'Bali',         center: { lat: -8.6480, lng: 115.1370 }, radius: 520, bestFor: ['House', 'Late Night'] },
  { id: 'singapore',   name: 'Clarke Quay',    city: 'Singapore',    center: { lat: 1.2900,  lng: 103.8460 }, radius: 500, bestFor: ['Dancing', 'Commercial'] },
  // MIDDLE EAST
  { id: 'dubai',       name: 'Dubai',          city: 'Dubai',        center: { lat: 25.2000, lng: 55.2700 }, radius: 560, bestFor: ['Dancing', 'Commercial'] },
  { id: 'telaviv',     name: 'Tel Aviv',       city: 'Tel Aviv',     center: { lat: 32.0700, lng: 34.7700 }, radius: 500, bestFor: ['Techno', 'Dancing'] },
  { id: 'istanbul-bey',name: 'Beyoğlu',        city: 'Istanbul',     center: { lat: 41.0360, lng: 28.9770 }, radius: 520, bestFor: ['Dancing', 'Techno'] },
  // BALTICS / BELARUS
  { id: 'minsk',       name: 'Minsk Centre',   city: 'Minsk',        center: { lat: 53.9020, lng: 27.5620 }, radius: 480, bestFor: ['Dancing', 'Techno'] },
  { id: 'vilnius',     name: 'Old Town',       city: 'Vilnius',      center: { lat: 54.6800, lng: 25.2830 }, radius: 460, bestFor: ['Techno', 'Dancing'] },
  { id: 'riga-lv',     name: 'Centrs',         city: 'Riga',         center: { lat: 56.9490, lng: 24.1050 }, radius: 460, bestFor: ['Dancing', 'Techno'] },
  { id: 'tallinn',     name: 'Old Town',       city: 'Tallinn',      center: { lat: 59.4370, lng: 24.7530 }, radius: 460, bestFor: ['Techno', 'Late Night'] },
  // LUXEMBOURG
  { id: 'luxembourg',  name: 'Luxembourg City', city: 'Luxembourg',  center: { lat: 49.6110, lng: 6.1300 }, radius: 460, bestFor: ['Dancing', 'Live'] },
  // OCEANIA
  { id: 'sydney',      name: 'Sydney CBD',     city: 'Sydney',       center: { lat: -33.8770, lng: 151.2050 }, radius: 520, bestFor: ['Dancing', 'House'] },
  { id: 'melbourne',   name: 'Melbourne CBD',  city: 'Melbourne',    center: { lat: -37.8130, lng: 144.9630 }, radius: 520, bestFor: ['Techno', 'Dancing'] },
  // AFRICA
  { id: 'capetown',    name: 'Cape Town',      city: 'Cape Town',    center: { lat: -33.9200, lng: 18.4200 }, radius: 500, bestFor: ['House', 'Dancing'] },

  // ============ INDIA / CHINA / REST OF WORLD ============
  // INDIA
  { id: 'mumbai',      name: 'Lower Parel',    city: 'Mumbai',       center: { lat: 19.0130, lng: 72.8300 }, radius: 520, bestFor: ['Dancing', 'Commercial'] },
  { id: 'delhi',       name: 'Hauz Khas',      city: 'Delhi',        center: { lat: 28.5530, lng: 77.1940 }, radius: 520, bestFor: ['Dancing', 'Hip-Hop'] },
  { id: 'bangalore',   name: 'Indiranagar',    city: 'Bangalore',    center: { lat: 12.9720, lng: 77.6400 }, radius: 500, bestFor: ['Live', 'Dancing'] },
  { id: 'goa',         name: 'North Goa',      city: 'Goa',          center: { lat: 15.5900, lng: 73.7500 }, radius: 560, bestFor: ['House', 'Late Night'] },
  // CHINA + HONG KONG
  { id: 'shanghai',    name: 'The Bund',       city: 'Shanghai',     center: { lat: 31.2350, lng: 121.4900 }, radius: 540, bestFor: ['Techno', 'Dancing'] },
  { id: 'beijing',     name: 'Sanlitun',       city: 'Beijing',      center: { lat: 39.9330, lng: 116.4470 }, radius: 520, bestFor: ['Techno', 'Dancing'] },
  { id: 'chengdu',     name: 'Chengdu',        city: 'Chengdu',      center: { lat: 30.6500, lng: 104.0600 }, radius: 500, bestFor: ['Dancing', 'Techno'] },
  { id: 'hongkong',    name: 'Central / LKF',  city: 'Hong Kong',    center: { lat: 22.2810, lng: 114.1550 }, radius: 500, bestFor: ['Dancing', 'Commercial'] },
  // REST OF ASIA
  { id: 'taipei',      name: 'Xinyi',          city: 'Taipei',       center: { lat: 25.0360, lng: 121.5670 }, radius: 500, bestFor: ['Dancing', 'Hip-Hop'] },
  { id: 'kualalumpur', name: 'Bukit Bintang',  city: 'Kuala Lumpur', center: { lat: 3.1470,  lng: 101.7100 }, radius: 500, bestFor: ['Dancing', 'Rooftops'] },
  { id: 'manila',      name: 'Poblacion',      city: 'Manila',       center: { lat: 14.5650, lng: 121.0290 }, radius: 500, bestFor: ['Dancing', 'Hip-Hop'] },
  { id: 'jakarta',     name: 'SCBD',           city: 'Jakarta',      center: { lat: -6.2250, lng: 106.8090 }, radius: 520, bestFor: ['Dancing', 'Commercial'] },
  // MIDDLE EAST / CAUCASUS
  { id: 'beirut',      name: 'Mar Mikhael',    city: 'Beirut',       center: { lat: 33.8990, lng: 35.5250 }, radius: 500, bestFor: ['Techno', 'Dancing'] },
  { id: 'tbilisi',     name: 'Tbilisi',        city: 'Tbilisi',      center: { lat: 41.7150, lng: 44.7900 }, radius: 480, bestFor: ['Techno', 'Late Night'] },
  // AFRICA (more)
  { id: 'lagos',       name: 'Victoria Island',city: 'Lagos',        center: { lat: 6.4290,  lng: 3.4270 }, radius: 520, bestFor: ['Afrobeats', 'Dancing'] },
  { id: 'nairobi',     name: 'Westlands',      city: 'Nairobi',      center: { lat: -1.2650, lng: 36.8030 }, radius: 500, bestFor: ['Afrobeats', 'Dancing'] },
  { id: 'marrakech',   name: 'Hivernage',      city: 'Marrakech',    center: { lat: 31.6280, lng: -8.0130 }, radius: 500, bestFor: ['Dancing', 'Commercial'] },
  { id: 'cairo',       name: 'Zamalek',        city: 'Cairo',        center: { lat: 30.0600, lng: 31.2200 }, radius: 500, bestFor: ['Live', 'Dancing'] },
  { id: 'joburg',      name: 'Braamfontein',   city: 'Johannesburg', center: { lat: -26.1930, lng: 28.0340 }, radius: 500, bestFor: ['House', 'Dancing'] },
  { id: 'accra',       name: 'Osu',            city: 'Accra',        center: { lat: 5.5560,  lng: -0.1830 }, radius: 500, bestFor: ['Afrobeats', 'Dancing'] },
  // NORTH AMERICA (more)
  { id: 'sf',          name: 'SoMa',           city: 'San Francisco',center: { lat: 37.7770, lng: -122.4130 }, radius: 500, bestFor: ['House', 'Techno'] },
  { id: 'detroit',     name: 'Detroit',        city: 'Detroit',      center: { lat: 42.3350, lng: -83.0450 }, radius: 500, bestFor: ['Techno', 'House'] },
  { id: 'dc',          name: 'U Street',       city: 'Washington',   center: { lat: 38.9170, lng: -77.0280 }, radius: 500, bestFor: ['Dancing', 'Hip-Hop'] },
  { id: 'austin',      name: 'Downtown',       city: 'Austin',       center: { lat: 30.2670, lng: -97.7400 }, radius: 500, bestFor: ['Live', 'Dancing'] },
  { id: 'houston-mid', name: 'Midtown / EaDo', city: 'Houston',      center: { lat: 29.7450, lng: -95.3620 }, radius: 520, bestFor: ['Dancing', 'Bars'] },
  { id: 'dallas-de',   name: 'Deep Ellum',     city: 'Dallas',       center: { lat: 32.7840, lng: -96.7840 }, radius: 480, bestFor: ['Live', 'Dancing'] },
  { id: 'sanantonio-dt', name: "St Mary's Strip", city: 'San Antonio', center: { lat: 29.4380, lng: -98.4880 }, radius: 480, bestFor: ['Live', 'Bars'] },
  { id: 'neworleans',  name: 'French Quarter', city: 'New Orleans',  center: { lat: 29.9600, lng: -90.0600 }, radius: 480, bestFor: ['Live', 'Dancing'] },
  { id: 'atlanta',     name: 'Atlanta',        city: 'Atlanta',      center: { lat: 33.7620, lng: -84.3830 }, radius: 500, bestFor: ['Hip-Hop', 'Dancing'] },
  { id: 'vancouver',   name: 'Granville',      city: 'Vancouver',    center: { lat: 49.2800, lng: -123.1200 }, radius: 500, bestFor: ['Dancing', 'House'] },
  // LATIN AMERICA / CARIBBEAN (more)
  { id: 'montevideo',  name: 'Montevideo',     city: 'Montevideo',   center: { lat: -34.9050, lng: -56.1900 }, radius: 480, bestFor: ['Techno', 'Dancing'] },
  { id: 'cartagena',   name: 'Getsemaní',      city: 'Cartagena',    center: { lat: 10.4230, lng: -75.5450 }, radius: 480, bestFor: ['Latin', 'Dancing'] },
  { id: 'havana',      name: 'Vedado',         city: 'Havana',       center: { lat: 23.1360, lng: -82.3890 }, radius: 500, bestFor: ['Latin', 'Live'] },
  { id: 'sanjuan',     name: 'Santurce',       city: 'San Juan',     center: { lat: 18.4480, lng: -66.0730 }, radius: 480, bestFor: ['Latin', 'Dancing'] },
  // OCEANIA (more)
  { id: 'brisbane',    name: 'Fortitude Valley',city: 'Brisbane',    center: { lat: -27.4570, lng: 153.0340 }, radius: 500, bestFor: ['Dancing', 'House'] },
  { id: 'perth',       name: 'Northbridge',    city: 'Perth',        center: { lat: -31.9480, lng: 115.8570 }, radius: 500, bestFor: ['Dancing', 'House'] },
  { id: 'auckland',    name: 'Auckland CBD',   city: 'Auckland',     center: { lat: -36.8480, lng: 174.7630 }, radius: 500, bestFor: ['Dancing', 'Techno'] },
  // EUROPE (gaps)
  { id: 'reykjavik',   name: 'Reykjavík',      city: 'Reykjavik',    center: { lat: 64.1470, lng: -21.9400 }, radius: 460, bestFor: ['Dancing', 'Live'] },
  { id: 'kyiv',        name: 'Podil',          city: 'Kyiv',         center: { lat: 50.4650, lng: 30.5170 }, radius: 500, bestFor: ['Techno', 'Late Night'] },
  { id: 'zagreb',      name: 'Zagreb',         city: 'Zagreb',       center: { lat: 45.8100, lng: 15.9780 }, radius: 480, bestFor: ['Techno', 'Dancing'] },
  // LGBTQ+ districts
  { id: 'tokyo-nichome', name: 'Shinjuku Ni-chōme', city: 'Tokyo',   center: { lat: 35.6940, lng: 139.7080 }, radius: 460, bestFor: ['Dancing', 'Late Night'] },

  // ============ EXPANSION: RUSSIA / C.ASIA / MORE AFRICA / BRAZIL COAST / CHINA ============
  { id: 'moscow',      name: 'Moscow',          city: 'Moscow',            center: { lat: 55.7558, lng: 37.6173 }, radius: 540, bestFor: ['Techno', 'Dancing'] },
  { id: 'spb',         name: 'Saint Petersburg',city: 'Saint Petersburg',  center: { lat: 59.9343, lng: 30.3351 }, radius: 520, bestFor: ['Techno', 'Late Night'] },
  { id: 'tashkent',    name: 'Tashkent',        city: 'Tashkent',          center: { lat: 41.2995, lng: 69.2401 }, radius: 500, bestFor: ['Dancing', 'Commercial'] },
  { id: 'almaty',      name: 'Almaty',          city: 'Almaty',            center: { lat: 43.2380, lng: 76.9450 }, radius: 500, bestFor: ['Dancing', 'Techno'] },
  { id: 'baku',        name: 'Baku',            city: 'Baku',              center: { lat: 40.4093, lng: 49.8671 }, radius: 500, bestFor: ['Dancing', 'Commercial'] },
  { id: 'yerevan',     name: 'Yerevan',         city: 'Yerevan',           center: { lat: 40.1792, lng: 44.4991 }, radius: 480, bestFor: ['Dancing', 'Live'] },
  { id: 'dakar',       name: 'Dakar',           city: 'Dakar',             center: { lat: 14.6928, lng: -17.4467 }, radius: 500, bestFor: ['Afrobeats', 'Dancing'] },
  { id: 'casablanca',  name: 'Casablanca',      city: 'Casablanca',        center: { lat: 33.5731, lng: -7.5898 }, radius: 520, bestFor: ['Dancing', 'Commercial'] },
  { id: 'addis',       name: 'Addis Ababa',     city: 'Addis Ababa',       center: { lat: 9.0300,  lng: 38.7400 }, radius: 500, bestFor: ['Live', 'Dancing'] },
  { id: 'durban',      name: 'Durban',          city: 'Durban',            center: { lat: -29.8587, lng: 31.0218 }, radius: 500, bestFor: ['House', 'Dancing'] },
  { id: 'shenzhen',    name: 'Shenzhen',        city: 'Shenzhen',          center: { lat: 22.5431, lng: 114.0579 }, radius: 520, bestFor: ['Techno', 'Dancing'] },
  { id: 'camboriu',    name: 'Balneário Camboriú', city: 'Camboriú',       center: { lat: -26.9906, lng: -48.6350 }, radius: 540, bestFor: ['House', 'Dancing'] },
  // --- more Africa ---
  { id: 'kampala',     name: 'Kisementi',       city: 'Kampala',           center: { lat: 0.3350,  lng: 32.5900 }, radius: 480, bestFor: ['Dancing', 'Live'] },
  { id: 'dar',         name: 'Masaki',          city: 'Dar es Salaam',     center: { lat: -6.7450, lng: 39.2760 }, radius: 500, bestFor: ['Dancing', 'Beach'] },
  { id: 'kigali',      name: 'Kimihurura',      city: 'Kigali',            center: { lat: -1.9500, lng: 30.0900 }, radius: 460, bestFor: ['Dancing', 'Bars'] },
  { id: 'abidjan',     name: 'Zone 4',          city: 'Abidjan',           center: { lat: 5.3000,  lng: -3.9900 }, radius: 500, bestFor: ['Dancing', 'Live'] },
  { id: 'tunis',       name: 'Gammarth',        city: 'Tunis',             center: { lat: 36.9200, lng: 10.2900 }, radius: 500, bestFor: ['Dancing', 'Beach'] },
  { id: 'luanda',      name: 'Ilha de Luanda',  city: 'Luanda',            center: { lat: -8.7900, lng: 13.2300 }, radius: 500, bestFor: ['Dancing', 'Beach'] },
  { id: 'maputo',      name: 'Maputo',          city: 'Maputo',            center: { lat: -25.9660, lng: 32.5800 }, radius: 480, bestFor: ['Dancing', 'Live'] },
  { id: 'zanzibar',    name: 'Stone Town',      city: 'Zanzibar',          center: { lat: -6.1620, lng: 39.1900 }, radius: 460, bestFor: ['Beach', 'Bars'] },
  { id: 'mombasa',     name: 'Nyali',           city: 'Mombasa',           center: { lat: -4.0300, lng: 39.7000 }, radius: 500, bestFor: ['Beach', 'Dancing'] },
  { id: 'harare',      name: 'Avondale',        city: 'Harare',            center: { lat: -17.8000, lng: 31.0400 }, radius: 480, bestFor: ['Bars', 'Live'] },
  // --- Central America / Caribbean ---
  { id: 'managua',     name: 'Zona Hippos',     city: 'Managua',           center: { lat: 12.1180, lng: -86.2670 }, radius: 480, bestFor: ['Dancing', 'Bars'] },
  { id: 'sanpedrosula',name: 'Zona Viva',       city: 'San Pedro Sula',    center: { lat: 15.5040, lng: -88.0250 }, radius: 460, bestFor: ['Dancing', 'Bars'] },
  { id: 'belizecity',  name: 'Belize City',     city: 'Belize City',       center: { lat: 17.4980, lng: -88.1900 }, radius: 460, bestFor: ['Bars', 'Beach'] },
  { id: 'roatan',      name: 'West End',        city: 'Roatán',            center: { lat: 16.2960, lng: -86.5960 }, radius: 420, bestFor: ['Beach', 'Bars'] },
  { id: 'bocas',       name: 'Bocas Town',      city: 'Bocas del Toro',    center: { lat: 9.3400,  lng: -82.2410 }, radius: 420, bestFor: ['Beach', 'Late Night'] },
  { id: 'antigua-gt',  name: 'Antigua',         city: 'Antigua Guatemala', center: { lat: 14.5570, lng: -90.7330 }, radius: 420, bestFor: ['Bars', 'Live'] },
  { id: 'leon-ni',     name: 'Centro',          city: 'León',              center: { lat: 12.4340, lng: -86.8780 }, radius: 420, bestFor: ['Bars', 'Live'] },
  { id: 'playadelcarmen',name: 'Quinta Avenida', city: 'Playa del Carmen', center: { lat: 20.6270, lng: -87.0740 }, radius: 480, bestFor: ['Dancing', 'Beach'] },
  // --- more South America ---
  { id: 'quito',       name: 'La Mariscal',     city: 'Quito',             center: { lat: -0.2050, lng: -78.4900 }, radius: 480, bestFor: ['Dancing', 'Bars'] },
  { id: 'guayaquil',   name: 'Urdesa',          city: 'Guayaquil',         center: { lat: -2.1730, lng: -79.9000 }, radius: 480, bestFor: ['Dancing', 'Bars'] },
  { id: 'caracas',     name: 'Las Mercedes',    city: 'Caracas',           center: { lat: 10.4700, lng: -66.8570 }, radius: 480, bestFor: ['Dancing', 'Bars'] },
  { id: 'lapaz',       name: 'Sopocachi',       city: 'La Paz',            center: { lat: -16.5060, lng: -68.1300 }, radius: 460, bestFor: ['Bars', 'Live'] },
  { id: 'cordoba',     name: 'Nueva Córdoba',   city: 'Córdoba',           center: { lat: -31.4270, lng: -64.1880 }, radius: 480, bestFor: ['Dancing', 'Bars'] },
  { id: 'floripa',     name: 'Jurerê',          city: 'Florianópolis',     center: { lat: -27.4360, lng: -48.4980 }, radius: 520, bestFor: ['House', 'Beach'] },
  { id: 'salvador',    name: 'Rio Vermelho',    city: 'Salvador',          center: { lat: -13.0100, lng: -38.4900 }, radius: 500, bestFor: ['Live', 'Dancing'] },
  { id: 'cusco',       name: 'Plaza de Armas',  city: 'Cusco',             center: { lat: -13.5170, lng: -71.9780 }, radius: 420, bestFor: ['Bars', 'Dancing'] },
  { id: 'valparaiso',  name: 'Cerro Alegre',    city: 'Valparaíso',        center: { lat: -33.0400, lng: -71.6270 }, radius: 460, bestFor: ['Bars', 'Live'] },
  { id: 'cali',        name: 'Granada',         city: 'Cali',              center: { lat: 3.4550,  lng: -76.5350 }, radius: 500, bestFor: ['Salsa', 'Dancing'] },
  // --- more Los Angeles ---
  { id: 'la-weho',     name: 'West Hollywood',  city: 'Los Angeles',       center: { lat: 34.0900, lng: -118.3850 }, radius: 460, bestFor: ['Dancing', 'Bars'] },
  { id: 'la-ktown',    name: 'Koreatown',       city: 'Los Angeles',       center: { lat: 34.0600, lng: -118.3000 }, radius: 460, bestFor: ['Bars', 'Late Night'] },
  { id: 'la-santamonica',name: 'Santa Monica',  city: 'Los Angeles',       center: { lat: 34.0150, lng: -118.4960 }, radius: 460, bestFor: ['Bars', 'Dancing'] },
  { id: 'la-venice',   name: 'Venice',          city: 'Los Angeles',       center: { lat: 33.9900, lng: -118.4650 }, radius: 440, bestFor: ['Bars', 'Beach'] },
  { id: 'la-echopark',  name: 'Echo Park',      city: 'Los Angeles',       center: { lat: 34.0780, lng: -118.2600 }, radius: 420, bestFor: ['Bars', 'Dancing'] },
  // --- fill blank regions: interior Africa ---
  { id: 'abuja',       name: 'Wuse',            city: 'Abuja',             center: { lat: 9.0820,  lng: 7.4720 },  radius: 480, bestFor: ['Dancing', 'Bars'] },
  { id: 'portharcourt',name: 'Port Harcourt',   city: 'Port Harcourt',     center: { lat: 4.8156,  lng: 7.0498 },  radius: 480, bestFor: ['Dancing', 'Bars'] },
  { id: 'kumasi',      name: 'Kumasi',          city: 'Kumasi',            center: { lat: 6.6885,  lng: -1.6244 }, radius: 480, bestFor: ['Dancing', 'Live'] },
  { id: 'douala',      name: 'Douala',          city: 'Douala',            center: { lat: 4.0511,  lng: 9.7679 },  radius: 480, bestFor: ['Dancing', 'Live'] },
  { id: 'kinshasa',    name: 'Gombe',           city: 'Kinshasa',          center: { lat: -4.3000, lng: 15.3000 }, radius: 500, bestFor: ['Dancing', 'Live'] },
  { id: 'lusaka',      name: 'Lusaka',          city: 'Lusaka',            center: { lat: -15.4167, lng: 28.2833 }, radius: 480, bestFor: ['Dancing', 'Bars'] },
  { id: 'gaborone',    name: 'Gaborone',        city: 'Gaborone',          center: { lat: -24.6282, lng: 25.9231 }, radius: 480, bestFor: ['Bars', 'Dancing'] },
  { id: 'windhoek',    name: 'Windhoek',        city: 'Windhoek',          center: { lat: -22.5700, lng: 17.0836 }, radius: 480, bestFor: ['Bars', 'Dancing'] },
  { id: 'antananarivo',name: 'Antananarivo',    city: 'Antananarivo',      center: { lat: -18.8792, lng: 47.5079 }, radius: 480, bestFor: ['Dancing', 'Live'] },
  { id: 'bamako',      name: 'Bamako',          city: 'Bamako',            center: { lat: 12.6392, lng: -8.0029 }, radius: 480, bestFor: ['Live', 'Dancing'] },
  // --- interior USA + Canada ---
  { id: 'calgary',     name: 'Calgary',         city: 'Calgary',           center: { lat: 51.0447, lng: -114.0719 }, radius: 480, bestFor: ['Dancing', 'Bars'] },
  { id: 'edmonton',    name: 'Edmonton',        city: 'Edmonton',          center: { lat: 53.5461, lng: -113.4938 }, radius: 480, bestFor: ['Dancing', 'Bars'] },
  { id: 'winnipeg',    name: 'Winnipeg',        city: 'Winnipeg',          center: { lat: 49.8951, lng: -97.1384 }, radius: 480, bestFor: ['Bars', 'Dancing'] },
  { id: 'ottawa',      name: 'ByWard Market',   city: 'Ottawa',            center: { lat: 45.4275, lng: -75.6920 }, radius: 460, bestFor: ['Bars', 'Dancing'] },
  { id: 'boise',       name: 'Boise',           city: 'Boise',             center: { lat: 43.6150, lng: -116.2023 }, radius: 460, bestFor: ['Bars', 'Live'] },
  { id: 'omaha',       name: 'Old Market',      city: 'Omaha',             center: { lat: 41.2555, lng: -95.9269 }, radius: 460, bestFor: ['Bars', 'Dancing'] },
  { id: 'albuquerque', name: 'Nob Hill',        city: 'Albuquerque',       center: { lat: 35.0808, lng: -106.6120 }, radius: 460, bestFor: ['Bars', 'Live'] },
  { id: 'louisville',  name: 'NuLu',            city: 'Louisville',        center: { lat: 38.2542, lng: -85.7420 }, radius: 460, bestFor: ['Bars', 'Live'] },
  { id: 'elpaso',      name: 'El Paso',         city: 'El Paso',           center: { lat: 31.7619, lng: -106.4850 }, radius: 460, bestFor: ['Bars', 'Dancing'] },
  // --- South America interior + more ---
  { id: 'brasilia',    name: 'Asa Sul',         city: 'Brasília',          center: { lat: -15.8100, lng: -47.8900 }, radius: 500, bestFor: ['Dancing', 'Bars'] },
  { id: 'curitiba',    name: 'Batel',           city: 'Curitiba',          center: { lat: -25.4400, lng: -49.2900 }, radius: 480, bestFor: ['Bars', 'Dancing'] },
  { id: 'portoalegre', name: 'Moinhos de Vento', city: 'Porto Alegre',     center: { lat: -30.0250, lng: -51.2050 }, radius: 480, bestFor: ['Bars', 'Dancing'] },
  { id: 'belohorizonte',name: 'Savassi',        city: 'Belo Horizonte',    center: { lat: -19.9380, lng: -43.9330 }, radius: 480, bestFor: ['Bars', 'Dancing'] },
  { id: 'recife',      name: 'Boa Viagem',      city: 'Recife',            center: { lat: -8.1200, lng: -34.9000 }, radius: 500, bestFor: ['Dancing', 'Beach'] },
  { id: 'fortaleza',   name: 'Praia de Iracema', city: 'Fortaleza',        center: { lat: -3.7200, lng: -38.5200 }, radius: 500, bestFor: ['Dancing', 'Beach'] },
  { id: 'rosario',     name: 'Rosario',         city: 'Rosario',           center: { lat: -32.9442, lng: -60.6505 }, radius: 480, bestFor: ['Dancing', 'Bars'] },
  { id: 'mendoza',     name: 'Chacras',         city: 'Mendoza',           center: { lat: -32.8908, lng: -68.8272 }, radius: 480, bestFor: ['Bars', 'Dancing'] },
  { id: 'asuncion',    name: 'Asunción',        city: 'Asunción',          center: { lat: -25.2820, lng: -57.6350 }, radius: 480, bestFor: ['Dancing', 'Bars'] },
  { id: 'santacruz',   name: 'Equipetrol',      city: 'Santa Cruz',        center: { lat: -17.7600, lng: -63.1980 }, radius: 480, bestFor: ['Dancing', 'Bars'] },
  // --- Central Asia ---
  { id: 'bishkek',     name: 'Bishkek',         city: 'Bishkek',           center: { lat: 42.8746, lng: 74.5698 }, radius: 480, bestFor: ['Dancing', 'Bars'] },
  { id: 'astana',      name: 'Astana',          city: 'Astana',            center: { lat: 51.1605, lng: 71.4704 }, radius: 480, bestFor: ['Dancing', 'Bars'] },
];

// Per-venue tuning:
//  peakHour  – hour the venue historically peaks (24h float, may pass midnight)
//  spread    – how sharp/broad the night curve is
//  peakRate  – expected check-ins per 30 min at its peak on a busy night
//  price     – typical entry band (0 = free)
//  sim       – seed profile for the ambient simulator & backfill trajectory:
//              mult (baseline scale) + trend (-1 cooling … +1 surging)
const VENUE_DEFS = [
  // GAZI — big late clubs
  ['Bios',            'gazi', 'Dancing',    'Club',     420, 1.5,  22, 15, { mult: 1.15, trend: 0.9 }, true],
  ['Gazarte',         'gazi', 'Live',       'Venue',    500, 0.5,  20, 10, { mult: 0.9,  trend: 0.3 }, false],
  ['A for Athens',    'gazi', 'Rooftops',   'Rooftop',  180, 0.0,  10, 0,  { mult: 0.75, trend: -0.4 }, false],
  ['Steam',           'gazi', 'Dancing',    'Club',     360, 1.8,  20, 10, { mult: 1.1,  trend: 1.0 }, true],
  ['Nipiagogeio',     'gazi', 'Late Night', 'Club',     260, 2.2,  16, 10, { mult: 0.95, trend: 0.6 }, false],

  // PSYRRI — bars + dance
  ['Six DOGS',        'psyrri', 'Dancing',   'Club',    300, 1.0,  18, 8,  { mult: 1.05, trend: 0.8 }, true],
  ['Faust',           'psyrri', 'Late Night','Club',    200, 1.5,  14, 8,  { mult: 0.9,  trend: 0.5 }, false],
  ['Noel',            'psyrri', 'Cocktails', 'Bar',     140, 0.0,  10, 0,  { mult: 0.85, trend: 0.2 }, false],
  ['The Clumsies',    'psyrri', 'Cocktails', 'Bar',     160, -0.3, 11, 0,  { mult: 0.9,  trend: -0.2 }, true],
  ['Beaver Cooperativa', 'psyrri', 'Bars', 'Bar',    120, 0.3,  8,  0,  { mult: 0.7,  trend: 0.1 }, false],

  // MONASTIRAKI — rooftops + bars
  ['Couleur Locale',  'monastiraki', 'Rooftops', 'Rooftop', 220, 0.0,  12, 5, { mult: 0.95, trend: 0.4 }, true],
  ['360 Cocktail',    'monastiraki', 'Cocktails','Rooftop', 180, -0.2, 10, 0, { mult: 0.85, trend: 0.2 }, false],
  ['Six d.o.g.s Yard','monastiraki', 'Bars',     'Bar',     140, 0.2,  9,  0, { mult: 0.75, trend: 0.0 }, false],

  // KOLONAKI — upscale cocktails
  ['Minnie the Moocher', 'kolonaki', 'Cocktails', 'Bar',   150, -0.4, 10, 0, { mult: 0.9, trend: 0.1 }, false],
  ['CV Distiller',    'kolonaki', 'Cocktails', 'Bar',      170, -0.2, 11, 0, { mult: 0.85, trend: 0.3 }, true],
  ['Rock n Roll',     'kolonaki', 'Dancing',   'Club',     260, 1.0,  15, 12, { mult: 1.0, trend: 0.7 }, false],
  ['Passepartout',    'kolonaki', 'Late Night','Bar',      130, 0.5,  8,  0, { mult: 0.7, trend: 0.0 }, false],

  // EXARCHEIA — live + late
  ['Blue Bird',       'exarcheia', 'Live',      'Venue',   200, 0.0, 10, 5, { mult: 0.8, trend: 0.2 }, false],
  ['Alaska',          'exarcheia', 'Late Night','Bar',     120, 1.2, 9,  0, { mult: 0.85, trend: 0.6 }, false],
  ['Tsin Tsin',       'exarcheia', 'Cocktails', 'Bar',     100, 0.0, 7,  0, { mult: 0.7, trend: 0.1 }, false],
  ['Ippo',            'exarcheia', 'Bars',      'Bar',     110, 0.3, 8,  0, { mult: 0.75, trend: 0.3 }, false],

  // KOUKAKI — wine + neighbourhood bars
  ['Hitchcocktales',  'koukaki', 'Cocktails', 'Bar',       120, -0.2, 8, 0, { mult: 0.75, trend: 0.0 }, false],
  ['Materia Prima',   'koukaki', 'Wine',      'Wine Bar',  110, -0.8, 7, 0, { mult: 0.7, trend: -0.2 }, false],
  ['Bel Ray',         'koukaki', 'Bars',      'Bar',       130, 0.0,  8, 0, { mult: 0.72, trend: 0.2 }, false],

  // THESSALONIKI — Valaoritou & Ladadika bar districts
  ['Vogatsikou 3',    'valaoritou', 'Cocktails', 'Bar',   150, -0.2, 11, 0,  { mult: 0.95, trend: 0.5 }, true],
  ['Gorillas',        'valaoritou', 'Bars',      'Bar',   160, 0.2,  12, 0,  { mult: 1.0,  trend: 0.7 }, false],
  ['Canteen',         'valaoritou', 'Bars',      'Bar',   140, 0.0,  10, 0,  { mult: 0.9,  trend: 0.4 }, false],
  ['Urania',          'valaoritou', 'Late Night','Bar',   130, 0.6,  9,  0,  { mult: 0.85, trend: 0.6 }, false],
  ['Partizan',        'ladadika',   'Bars',      'Bar',   150, 0.3,  10, 0,  { mult: 0.9,  trend: 0.5 }, false],
  ['Fragile',         'ladadika',   'Dancing',   'Club',  260, 1.0,  15, 8,  { mult: 1.05, trend: 0.8 }, true],

  // MYKONOS — Chora
  ['Scandinavian Bar','mykonos-town','Dancing',  'Club',  360, 1.2,  18, 10, { mult: 1.1,  trend: 0.9 }, true],
  ['180° Sunset Bar', 'mykonos-town','Cocktails', 'Rooftop',180,-1.5,10, 12, { mult: 0.8,  trend: -0.5 }, false],
  ["Bao's Cocktail Bar",'mykonos-town','Cocktails','Bar', 140,-0.2, 11, 0,  { mult: 0.9,  trend: 0.3 }, true],
  ['Void Club',       'mykonos-town','Dancing',   'Club', 300, 1.8,  16, 15, { mult: 1.0,  trend: 1.0 }, false],
  ['Toy Room',        'mykonos-town','Late Night', 'Club',220, 1.5,  13, 20, { mult: 0.95, trend: 0.7 }, false],

  // SANTORINI — Fira
  ['Kira Thira',      'fira', 'Cocktails', 'Bar', 120, -0.4, 9,  0, { mult: 0.85, trend: 0.2 }, false],
  ['MoMix',           'fira', 'Cocktails', 'Bar', 130, 0.0,  10, 0, { mult: 0.9,  trend: 0.5 }, true],
  ['Two Brothers Bar','fira', 'Bars',      'Bar', 150, 0.3,  11, 0, { mult: 0.95, trend: 0.6 }, false],
  ['PK Cocktail Bar', 'fira', 'Cocktails', 'Bar', 120, -0.5, 9,  0, { mult: 0.8,  trend: 0.1 }, false],

  // HERAKLION (Crete) — Chandakos
  ['Xalavro Open Bar', 'chandakos', 'Cocktails', 'Bar', 200, 0.2, 12, 0, { mult: 0.95, trend: 0.5 }, true],
  ['Swing Thing',      'chandakos', 'Cocktails', 'Bar', 160, 0.0, 11, 0, { mult: 0.9,  trend: 0.4 }, false],
  ['The Bitters Bar',  'chandakos', 'Cocktails', 'Bar', 150, 0.0, 10, 0, { mult: 0.9,  trend: 0.4 }, false],

  // CHANIA (Crete) — Old Harbour
  ['Sinagogi',        'chania-old', 'Cocktails', 'Bar', 200, 0.0, 11, 0, { mult: 0.95, trend: 0.4 }, true],
  ['Melodica',        'chania-old', 'Cocktails', 'Bar', 160, 0.1, 10, 0, { mult: 0.9,  trend: 0.4 }, false],
  ['Bras de Frères',  'chania-old', 'Bars',      'Bar', 170, 0.2, 10, 0, { mult: 0.9,  trend: 0.5 }, false],

  // PATRAS — Riga Feraiou
  ['Beer Bar Q',          'riga', 'Bars',    'Bar',  200, 0.2, 12, 0, { mult: 0.95, trend: 0.5 }, true],
  ['Navona Club Di Oggi', 'riga', 'Dancing', 'Club', 400, 1.4, 15, 8, { mult: 1.0,  trend: 0.7 }, false],
  ['Frida Stage',         'riga', 'Bars',    'Bar',  180, 0.3, 11, 0, { mult: 0.9,  trend: 0.5 }, false],

  // RHODES — Old Town
  ['Colorado Club',   'rhodes-old', 'Dancing',  'Club',    300, 1.0, 14, 10, { mult: 1.0,  trend: 0.7 }, false],
  ['Macao Bar',       'rhodes-old', 'Rooftops', 'Rooftop', 150, -0.3, 9,  0, { mult: 0.85, trend: 0.3 }, true],

  // CORFU — Corfu Town
  ['54 Dreamy Nights','corfu-town', 'Dancing', 'Club', 320, 1.2, 15, 12, { mult: 1.05, trend: 0.8 }, true],
  ['Bora Bora',       'corfu-town', 'Bars',    'Bar',  150, 0.3, 10, 0,  { mult: 0.9,  trend: 0.5 }, false],

  // GERMANY — Berlin & Munich
  ['Berghain',        'friedrichshain', 'Dancing', 'Club', 600, 2.4, 24, 25, { mult: 1.2,  trend: 1.0 }, true],
  ['Sisyphos',        'friedrichshain', 'Dancing', 'Club', 500, 2.2, 20, 15, { mult: 1.05, trend: 0.9 }, false],
  ['Tresor',          'kreuzberg',      'Dancing', 'Club', 500, 2.3, 19, 18, { mult: 1.05, trend: 0.9 }, false],
  ['Blitz Club',      'sonnenstrasse',  'Dancing', 'Club', 350, 1.8, 15, 12, { mult: 1.0,  trend: 0.8 }, true],

  // ITALY — Milan & Rome
  ['Amnesia Milano',  'navigli',  'Dancing', 'Club', 500, 1.6, 18, 18, { mult: 1.1,  trend: 0.8 }, true],
  ['Volt',            'navigli',  'Dancing', 'Club', 350, 1.4, 14, 15, { mult: 0.95, trend: 0.7 }, false],  ['Shari Vari',      'ostiense', 'Dancing', 'Club', 300, 1.0, 13, 15, { mult: 0.95, trend: 0.6 }, false],

  // FRANCE — Paris
  ['Rex Club',        'oberkampf', 'Dancing', 'Club', 450, 1.8, 17, 15, { mult: 1.05, trend: 0.9 }, true],
  ['Badaboum',        'oberkampf', 'Dancing', 'Club', 300, 1.4, 14, 15, { mult: 1.0,  trend: 0.7 }, false],
  ['La Machine du Moulin Rouge', 'pigalle', 'Dancing', 'Club', 500, 1.6, 17, 18, { mult: 1.05, trend: 0.8 }, true],

  // SERBIA — Belgrade (Savamala / river clubs)
  ['Drugstore',       'savamala', 'Dancing', 'Club', 500, 2.2, 20, 12, { mult: 1.1,  trend: 0.9 }, true],
  ['Klub 20/44',      'savamala', 'Dancing', 'Club', 350, 2.0, 15, 8,  { mult: 1.0,  trend: 0.8 }, false],
  ['Barutana',        'savamala', 'Dancing', 'Club', 450, 2.0, 17, 10, { mult: 1.0,  trend: 0.8 }, false],

  // SPAIN — Madrid, Barcelona, Ibiza
  ['Teatro Kapital',  'madrid-centro', 'Dancing', 'Club', 600, 1.6, 20, 20, { mult: 1.1,  trend: 0.8 }, true],
  ['Joy Eslava',      'madrid-centro', 'Dancing', 'Club', 400, 1.2, 15, 15, { mult: 0.95, trend: 0.6 }, false],
  ['Razzmatazz',      'poblenou',      'Dancing', 'Club', 700, 1.8, 22, 18, { mult: 1.15, trend: 0.9 }, true],
  ['Opium Barcelona', 'poblenou',      'Dancing', 'Club', 500, 1.0, 16, 20, { mult: 1.0,  trend: 0.6 }, false],
  ['Shôko',           'poblenou',      'Dancing', 'Club', 600, 1.2, 16, 20, { mult: 1.05, trend: 0.7 }, false],
  ['Pacha Ibiza',     'ibiza', 'Dancing', 'Club', 800, 1.8, 26, 50, { mult: 1.2, trend: 1.0 }, true],
  ['Amnesia Ibiza',   'ibiza', 'Dancing', 'Club', 900, 2.0, 26, 50, { mult: 1.2, trend: 1.0 }, true],
  ['Ushuaïa',         'ibiza', 'Dancing', 'Club', 900, -1.0, 20, 70, { mult: 1.0, trend: -0.3 }, true],

  // MONTENEGRO — Budva
  ['Top Hill',        'budva', 'Dancing', 'Club', 3000, 1.6, 26, 15, { mult: 1.2, trend: 0.9 }, true],
  ['Trocadero',       'budva', 'Dancing', 'Club', 600,  1.2, 16, 15, { mult: 1.0, trend: 0.7 }, false],

  // BOSNIA — Sarajevo
  ['Silver & Smoke',  'sarajevo-centar', 'Dancing', 'Club', 400, 1.4, 15, 10, { mult: 1.0, trend: 0.7 }, true],
  ['Coloseum Club',   'sarajevo-centar', 'Dancing', 'Club', 500, 1.6, 16, 12, { mult: 1.0, trend: 0.8 }, false],

  // CROATIA — Zrće Beach (Pag) & Hvar
  ['Papaya',          'zrce', 'Dancing', 'Club', 3000, 1.5, 26, 12, { mult: 1.2,  trend: 0.9 }, true],
  ['Aquarius',        'zrce', 'Dancing', 'Club', 2000, 1.4, 22, 15, { mult: 1.1,  trend: 0.8 }, false],
  ['Carpe Diem',      'hvar', 'Cocktails', 'Club', 400, 0.5, 14, 20, { mult: 0.95, trend: 0.5 }, true],

  // KOSOVO — Pristina (bar/lounge-led scene)
  ['Zone Club',           'pristina', 'Dancing',  'Club', 500, 1.6, 16, 10, { mult: 1.05, trend: 0.8 }, true],
  ['tintin Cocktail Bar', 'pristina', 'Cocktails','Bar',  200, 0.0, 12, 0,  { mult: 0.95, trend: 0.5 }, false],
  ['Bubble Pub',          'pristina', 'Bars',     'Bar',  250, 0.2, 12, 0,  { mult: 0.9,  trend: 0.5 }, false, true],

  // ALBANIA — Tirana (Blloku)
  ['Lollipop',        'blloku', 'Dancing',  'Club',    400, 1.4, 14, 12, { mult: 1.0,  trend: 0.7 }, false],

  // HUNGARY — Budapest (District VII)
  ['Instant-Fogas',    'erzsebetvaros', 'Dancing', 'Club',  1500, 1.6, 22, 8,  { mult: 1.15, trend: 0.9 }, true],
  ['Szimpla Kert',     'erzsebetvaros', 'Bars',    'Bar',    700, 0.0, 14, 0,  { mult: 0.95, trend: 0.3 }, true],
  ['Akvárium Klub',    'erzsebetvaros', 'Live',    'Venue',  800, 0.8, 16, 10, { mult: 1.0,  trend: 0.6 }, false],
  ['Ötkert',           'erzsebetvaros', 'Dancing', 'Club',   600, 1.2, 15, 10, { mult: 1.0,  trend: 0.7 }, false],

  // CZECHIA — Prague
  ['Karlovy Lázně',    'stare-mesto-prg', 'Dancing', 'Club',  2000, 1.4, 22, 8,  { mult: 1.15, trend: 0.8 }, true],
  ['Roxy',             'stare-mesto-prg', 'Dancing', 'Club',   900, 1.6, 17, 12, { mult: 1.05, trend: 0.8 }, false],
  ['Cross Club',       'stare-mesto-prg', 'Dancing', 'Club',   600, 1.8, 15, 5,  { mult: 1.0,  trend: 0.9 }, true],
  ['Lucerna Music Bar','stare-mesto-prg', 'Live',    'Venue',  700, 0.6, 14, 6,  { mult: 0.9,  trend: 0.4 }, false],
  ['Duplex',           'stare-mesto-prg', 'Dancing', 'Club',   800, 1.2, 17, 12, { mult: 1.1,  trend: 0.8 }, true],

  // SLOVAKIA — Bratislava
  ['Nu Spirit Club',   'stare-mesto-ba', 'Dancing', 'Club',    400, 1.2, 14, 8,  { mult: 1.0,  trend: 0.7 }, true],
  ['Subclub',          'stare-mesto-ba', 'Dancing', 'Club',    350, 1.8, 13, 8,  { mult: 1.0,  trend: 0.9 }, false],
  ['KC Dunaj',         'stare-mesto-ba', 'Rooftops','Rooftop', 300, -0.2,11, 5,  { mult: 0.85, trend: 0.3 }, false],

  // ROMANIA — Bucharest
  ['Control Club',     'lipscani', 'Dancing', 'Club',  500, 1.2, 16, 8,  { mult: 1.05, trend: 0.8 }, true],
  ['Kristal Club',     'lipscani', 'Dancing', 'Club', 1500, 1.8, 20, 15, { mult: 1.1,  trend: 0.8 }, false],
  ['Expirat',          'lipscani', 'Live',    'Venue', 600, 0.8, 14, 8,  { mult: 0.95, trend: 0.5 }, false],
  ['Fratelli',         'lipscani', 'Dancing', 'Club',  700, 1.0, 15, 15, { mult: 1.0,  trend: 0.6 }, false],

  // POLAND — Warsaw & Kraków
  ['Smolna',           'srodmiescie', 'Dancing',    'Club', 600, 1.8, 18, 12, { mult: 1.1,  trend: 0.9 }, true],
  ['Luzztro',          'srodmiescie', 'Late Night', 'Club', 400, 2.6, 14, 10, { mult: 0.95, trend: 0.8 }, false],
  ['Iskra',            'srodmiescie', 'Bars',       'Bar',  300, 0.2, 11, 0,  { mult: 0.85, trend: 0.4 }, false],
  ['Prozak 2.0',       'krakow-stare','Dancing',    'Club', 500, 1.6, 16, 8,  { mult: 1.05, trend: 0.8 }, true],
  ['Szpitalna 1',      'krakow-stare','Dancing',    'Club', 350, 1.8, 13, 8,  { mult: 1.0,  trend: 0.9 }, false],

  // MOLDOVA — Chișinău
  ['Nuovo',            'chisinau-centru', 'Dancing',  'Club', 800, 1.4, 15, 10, { mult: 1.05, trend: 0.7 }, true],
  ['Q Club',           'chisinau-centru', 'Dancing',  'Club', 400, 1.2, 12, 8,  { mult: 0.95, trend: 0.6 }, false],
  ['Fumoir',           'chisinau-centru', 'Cocktails','Bar',  250, -0.2,10, 0,  { mult: 0.8,  trend: 0.2 }, false],

  // ROMANIA — Mamaia (Black Sea beach clubs, summer)
  ['Fratelli Beach',   'mamaia', 'Dancing',  'Club', 1500, 0.6, 22, 20, { mult: 1.15, trend: 0.9 }, true],
  ['Loft Mamaia',      'mamaia', 'Dancing',  'Club', 2000, 1.2, 24, 18, { mult: 1.15, trend: 0.9 }, false],
  ['Kudos Beach',      'mamaia', 'Cocktails','Club',  800, -0.5, 16, 12, { mult: 0.95, trend: 0.4 }, false],

  // POLAND — Sopot (Baltic beach clubs, summer)
  ['Sfinks700',        'sopot', 'Dancing', 'Club', 700, 1.4, 17, 10, { mult: 1.05, trend: 0.8 }, true],
  ['Koliba',           'sopot', 'Dancing', 'Club', 600, 1.0, 14, 10, { mult: 1.0,  trend: 0.7 }, false],
  ['Atelier',          'sopot', 'Dancing', 'Club', 900, 1.2, 16, 12, { mult: 1.05, trend: 0.7 }, false],

  // GERMANY — more Berlin & Munich
  ['KitKatClub',       'kreuzberg',      'Dancing', 'Club', 700, 2.2, 18, 20, { mult: 1.1,  trend: 0.9 }, true],
  ['://about blank',   'friedrichshain', 'Dancing', 'Club', 800, 2.2, 19, 15, { mult: 1.1,  trend: 0.9 }, false],
  ['Kater Blau',       'friedrichshain', 'Dancing', 'Club', 700, 2.0, 17, 15, { mult: 1.05, trend: 0.9 }, true],  ['Rote Sonne',       'sonnenstrasse',  'Dancing', 'Club', 400, 1.8, 13, 12, { mult: 1.0,  trend: 0.8 }, false],
  // GERMANY — Hamburg
  ['Uebel & Gefährlich','hamburg-stpauli','Dancing','Club', 600, 1.6, 16, 12, { mult: 1.05, trend: 0.8 }, true],
  ['PAL',              'hamburg-stpauli', 'Dancing', 'Club', 400, 1.8, 14, 12, { mult: 1.0,  trend: 0.8 }, false],
  ['Docks',            'hamburg-stpauli', 'Live',    'Venue',1500,0.8, 16, 15, { mult: 0.95, trend: 0.5 }, false],
  // GERMANY — Cologne
  ['Bootshaus',        'cologne-city', 'Dancing', 'Club', 1800, 1.6, 22, 18, { mult: 1.15, trend: 0.9 }, true],
  ['Gewölbe',          'cologne-city', 'Dancing', 'Club', 500,  1.8, 14, 12, { mult: 1.0,  trend: 0.8 }, false],
  // GERMANY — Frankfurt
  ['Robert Johnson',   'frankfurt-city', 'Dancing', 'Club', 400, 2.0, 14, 15, { mult: 1.05, trend: 0.9 }, true],
  ['Gibson',           'frankfurt-city', 'Dancing', 'Club', 800, 1.2, 15, 15, { mult: 1.0,  trend: 0.6 }, false],
  // GERMANY — Leipzig
  ['Distillery',       'leipzig-city', 'Dancing', 'Club', 500, 2.0, 14, 12, { mult: 1.05, trend: 0.8 }, true],
  ['Institut für Zukunft','leipzig-city','Dancing','Club', 400, 2.2, 13, 12, { mult: 1.0,  trend: 0.9 }, false],

  // FRANCE — more Paris
  ['Djoon',            'oberkampf', 'Dancing', 'Club', 400, 1.6, 14, 15, { mult: 1.0,  trend: 0.7 }, false],
  ['Glazart',          'pigalle',   'Dancing', 'Club', 600, 1.4, 14, 12, { mult: 1.0,  trend: 0.7 }, false],
  // FRANCE — Lyon
  ['Le Sucre',         'lyon', 'Dancing', 'Club', 600, 1.2, 16, 14, { mult: 1.05, trend: 0.8 }, true],  // FRANCE — Marseille
  ['R2 Rooftop',       'marseille', 'Rooftops', 'Rooftop', 500, -0.5, 14, 12, { mult: 0.95, trend: 0.4 }, true],
  ['Le Trolleybus',    'marseille', 'Dancing',  'Club',    500, 1.4,  13, 10, { mult: 1.0,  trend: 0.7 }, false],
  // FRANCE — Nice
  ['High Club',        'nice', 'Dancing', 'Club', 1200, 1.4, 18, 18, { mult: 1.1, trend: 0.8 }, true],

  // BELGIUM — Brussels
  ['Fuse',             'brussels', 'Dancing', 'Club', 700, 2.0, 17, 14, { mult: 1.1,  trend: 0.9 }, true],
  ['C12',              'brussels', 'Dancing', 'Club', 500, 2.0, 14, 14, { mult: 1.05, trend: 0.8 }, false],
  // BELGIUM — Antwerp
  ['Ampere',           'antwerp', 'Dancing', 'Club', 500, 1.8, 14, 13, { mult: 1.05, trend: 0.8 }, true],
  ["Cafe d'Anvers",    'antwerp', 'Dancing', 'Club', 600, 1.8, 15, 13, { mult: 1.05, trend: 0.8 }, false],
  // BELGIUM — Ghent
  ['Kompass Klub',     'ghent', 'Dancing', 'Club', 900, 2.0, 17, 15, { mult: 1.1,  trend: 0.9 }, true],
  ['Charlatan',        'ghent', 'Dancing', 'Club', 400, 1.4, 12, 8,  { mult: 0.95, trend: 0.7 }, false],

  // NETHERLANDS — Amsterdam
  ['Shelter',          'amsterdam', 'Dancing', 'Club', 600, 2.2, 16, 15, { mult: 1.1,  trend: 0.9 }, true],
  ['Paradiso',         'amsterdam', 'Live',    'Venue',1500,0.8, 18, 15, { mult: 1.0,  trend: 0.5 }, true],
  ['Melkweg',          'amsterdam', 'Live',    'Venue',1500,0.8, 17, 15, { mult: 1.0,  trend: 0.5 }, false],
  ['RADION',           'amsterdam', 'Dancing', 'Club', 700, 2.2, 15, 15, { mult: 1.05, trend: 0.9 }, false],
  // NETHERLANDS — Rotterdam
  ['Maassilo',         'rotterdam', 'Dancing', 'Club', 2000, 1.6, 20, 15, { mult: 1.1,  trend: 0.8 }, true],
  ['Perron',           'rotterdam', 'Dancing', 'Club', 800,  1.6, 16, 14, { mult: 1.05, trend: 0.8 }, true],
  ['Annabel',          'rotterdam', 'Dancing', 'Club', 900,  1.4, 16, 14, { mult: 1.05, trend: 0.7 }, false],

  // SPAIN — more Madrid & Barcelona
  ['Fabrik',           'madrid-centro', 'Dancing', 'Club', 2500, 1.8, 24, 18, { mult: 1.15, trend: 0.9 }, true],
  ['Mondo Disko',      'madrid-centro', 'Dancing', 'Club', 600,  1.8, 15, 15, { mult: 1.05, trend: 0.8 }, false],
  ['Sala Apolo',       'poblenou', 'Dancing', 'Club', 1000, 1.6, 18, 15, { mult: 1.1,  trend: 0.8 }, true],
  ['Pacha Barcelona',  'poblenou', 'Dancing', 'Club', 800,  1.4, 16, 20, { mult: 1.05, trend: 0.7 }, false],
  // SPAIN — Valencia
  ['Mya',              'valencia', 'Dancing', 'Club', 2000, 1.4, 20, 18, { mult: 1.1, trend: 0.8 }, true],
  ['Spook',            'valencia', 'Dancing', 'Club', 800,  1.6, 15, 12, { mult: 1.0, trend: 0.7 }, false],
  // SPAIN — Seville
  ['Abril',            'seville', 'Dancing', 'Club', 600, 1.4, 14, 12, { mult: 1.0, trend: 0.7 }, true],

  // PORTUGAL — Lisbon
  ['Lux Frágil',       'lisbon', 'Dancing', 'Club', 900, 2.0, 18, 15, { mult: 1.15, trend: 0.9 }, true],
  ['Ministerium',      'lisbon', 'Dancing', 'Club', 600, 1.8, 14, 13, { mult: 1.05, trend: 0.8 }, false],
  ['Music Box',        'lisbon', 'Dancing', 'Club', 400, 1.6, 13, 12, { mult: 1.0,  trend: 0.8 }, false],
  // PORTUGAL — Porto
  ['Gare Porto',       'porto', 'Dancing', 'Club', 400, 1.8, 13, 10, { mult: 1.0,  trend: 0.8 }, true],
  ['Plano B',          'porto', 'Dancing', 'Club', 400, 1.6, 12, 10, { mult: 0.95, trend: 0.7 }, false],

  // UK — London
  ['Fabric',              'central-london', 'Dancing', 'Club', 1600, 1.6, 22, 25, { mult: 1.15, trend: 0.9 }, true],
  ['Ministry of Sound',   'central-london', 'Dancing', 'Club', 1600, 1.6, 22, 22, { mult: 1.15, trend: 0.8 }, true],
  ['Heaven',              'central-london', 'Dancing', 'Club', 1000, 1.2, 17, 15, { mult: 1.05, trend: 0.7 }, false, true],
  ['XOYO',                'shoreditch', 'Dancing', 'Club', 800, 1.4, 17, 15, { mult: 1.1,  trend: 0.8 }, true],
  ['Village Underground', 'shoreditch', 'Live',    'Venue',700, 1.0, 15, 15, { mult: 1.0,  trend: 0.6 }, false],
  ['Corsica Studios',     'shoreditch', 'Dancing', 'Club', 500, 1.8, 14, 12, { mult: 1.05, trend: 0.8 }, false],
  // UK — Manchester
  ['The Warehouse Project','manchester', 'Dancing', 'Club', 3000, 1.6, 26, 28, { mult: 1.2,  trend: 0.9 }, true],
  ['The White Hotel',     'manchester', 'Dancing', 'Club', 400, 2.0, 13, 12, { mult: 1.05, trend: 0.9 }, true],
  ['Hidden',              'manchester', 'Dancing', 'Club', 700, 1.8, 15, 12, { mult: 1.05, trend: 0.8 }, false],
  ['Gorilla',             'manchester', 'Live',    'Venue',600, 0.8, 13, 12, { mult: 0.95, trend: 0.5 }, false],
  // UK — Glasgow
  ['Sub Club',            'glasgow', 'Dancing', 'Club', 400, 1.8, 14, 12, { mult: 1.1,  trend: 0.9 }, true],
  ['SWG3',                'glasgow', 'Dancing', 'Club', 1250,1.6, 18, 15, { mult: 1.1,  trend: 0.8 }, true],
  ['La Cheetah Club',     'glasgow', 'Dancing', 'Club', 200, 2.0, 11, 10, { mult: 1.0,  trend: 0.8 }, false],
  // UK — Leeds
  ['Mint Warehouse',      'leeds', 'Dancing', 'Club', 1000, 1.6, 17, 15, { mult: 1.1,  trend: 0.8 }, true],
  ['Beaver Works',        'leeds', 'Dancing', 'Club', 1500, 1.8, 18, 15, { mult: 1.1,  trend: 0.9 }, false],
  ['Mint Club',           'leeds', 'Dancing', 'Club', 400,  1.8, 13, 12, { mult: 1.0,  trend: 0.8 }, false],
  // UK — Birmingham
  ['Lab11',               'birmingham', 'Dancing', 'Club', 600, 1.8, 15, 12, { mult: 1.05, trend: 0.8 }, true],
  ['Suki10c',             'birmingham', 'Dancing', 'Club', 300, 1.6, 11, 10, { mult: 0.95, trend: 0.7 }, false],
  ["Mama Roux's",         'birmingham', 'Live',    'Venue',500, 0.8, 13, 10, { mult: 0.95, trend: 0.5 }, false],
  // UK — Liverpool
  ['24 Kitchen Street',   'liverpool', 'Dancing', 'Club', 400, 1.8, 13, 12, { mult: 1.05, trend: 0.8 }, true],
  ['Invisible Wind Factory','liverpool','Live',    'Venue',1200,1.0, 16, 15, { mult: 1.0,  trend: 0.6 }, false],
  ['Camp and Furnace',    'liverpool', 'Live',    'Venue',1000,1.0, 14, 12, { mult: 0.95, trend: 0.5 }, false],
  // UK — Bristol
  ['Motion',              'bristol', 'Dancing', 'Club', 3000, 1.6, 24, 20, { mult: 1.2,  trend: 0.9 }, true],
  ['Thekla',              'bristol', 'Dancing', 'Club', 500,  1.4, 13, 12, { mult: 1.0,  trend: 0.7 }, false],
  ['Lakota',              'bristol', 'Dancing', 'Club', 800,  1.8, 15, 14, { mult: 1.05, trend: 0.8 }, false],
  // UK — Newcastle
  ['Digital',             'newcastle', 'Dancing', 'Club', 1500, 1.6, 18, 15, { mult: 1.1,  trend: 0.8 }, true],
  ['World Headquarters',  'newcastle', 'Dancing', 'Club', 500,  1.4, 13, 10, { mult: 1.0,  trend: 0.7 }, false],
  // UK — Edinburgh
  ["Sneaky Pete's",       'edinburgh', 'Dancing', 'Club', 100, 1.8, 10, 8,  { mult: 1.0,  trend: 0.8 }, true],
  ['The Bongo Club',      'edinburgh', 'Dancing', 'Club', 350, 1.6, 12, 10, { mult: 1.0,  trend: 0.7 }, false],
  ['Cabaret Voltaire',    'edinburgh', 'Dancing', 'Club', 500, 1.6, 13, 10, { mult: 1.0,  trend: 0.7 }, false],
  // UK — Sheffield
  ['Hope Works',          'sheffield', 'Dancing', 'Club', 700, 2.0, 15, 13, { mult: 1.1,  trend: 0.9 }, true],
  ['Foundry',             'sheffield', 'Dancing', 'Club', 800, 1.4, 14, 10, { mult: 1.0,  trend: 0.6 }, false],
  // UK — Cardiff
  ['Clwb Ifor Bach',      'cardiff', 'Dancing', 'Club', 400, 1.4, 13, 10, { mult: 1.0,  trend: 0.7 }, true],
  ['Tramshed',            'cardiff', 'Live',    'Venue',1000,0.8, 14, 12, { mult: 0.95, trend: 0.5 }, false],
  // UK — Belfast
  ["Thompson's Garage",   'belfast', 'Dancing', 'Club', 700, 1.6, 14, 12, { mult: 1.05, trend: 0.8 }, true],
  ['Limelight',           'belfast', 'Dancing', 'Club', 600, 1.4, 13, 10, { mult: 1.0,  trend: 0.7 }, false],

  // AUSTRIA — Vienna
  ['Grelle Forelle',  'vienna', 'Dancing', 'Club', 700, 2.0, 18, 15, { mult: 1.1,  trend: 0.9 }, true],
  ['Flex',            'vienna', 'Dancing', 'Club', 800, 1.8, 17, 12, { mult: 1.05, trend: 0.8 }, true],
  ['Pratersauna',     'vienna', 'Dancing', 'Club', 900, 1.6, 18, 14, { mult: 1.05, trend: 0.7 }, false],
  ['Sass Music Club', 'vienna', 'Dancing', 'Club', 500, 1.8, 15, 13, { mult: 1.0,  trend: 0.8 }, false],
  // SLOVENIA — Ljubljana
  ['Klub K4',         'ljubljana', 'Dancing', 'Club', 500, 1.8, 15, 12, { mult: 1.05, trend: 0.8 }, true],
  ['Cvetličarna',     'ljubljana', 'Dancing', 'Club', 900, 1.4, 16, 14, { mult: 1.05, trend: 0.7 }, false],
  ['Channel Zero',    'ljubljana', 'Dancing', 'Club', 500, 2.0, 14, 10, { mult: 1.0,  trend: 0.8 }, false],
  // SWITZERLAND — Zürich & Geneva
  ['Hive Club',       'zurich', 'Dancing', 'Club', 600, 2.2, 16, 26, { mult: 1.1,  trend: 0.9 }, true],
  ['Zukunft',         'zurich', 'Dancing', 'Club', 400, 2.2, 14, 24, { mult: 1.05, trend: 0.9 }, false],
  ['Supermarket',     'zurich', 'Dancing', 'Club', 500, 2.0, 15, 26, { mult: 1.05, trend: 0.8 }, true],
  ['Audio Club',      'geneva', 'Dancing', 'Club', 600, 1.8, 16, 21, { mult: 1.05, trend: 0.8 }, true],
  ['La Gravière',     'geneva', 'Dancing', 'Club', 400, 2.0, 13, 16, { mult: 1.0,  trend: 0.8 }, false],

  // DENMARK — Copenhagen
  ['Culture Box',     'copenhagen', 'Dancing', 'Club', 500, 2.0, 15, 15, { mult: 1.05, trend: 0.8 }, true],
  ['Rust',            'copenhagen', 'Dancing', 'Club', 600, 1.6, 15, 14, { mult: 1.05, trend: 0.7 }, false],
  ['VEGA',            'copenhagen', 'Live',    'Venue',1500,0.8, 17, 15, { mult: 1.0,  trend: 0.5 }, true],  // BULGARIA — Sofia
  ['Yalta Club',      'sofia', 'Dancing', 'Club', 700, 1.8, 16, 12, { mult: 1.1,  trend: 0.8 }, true],
  ['Chervilo',        'sofia', 'Dancing', 'Club', 600, 1.6, 15, 10, { mult: 1.05, trend: 0.7 }, false],
  ['Bedroom Premium', 'sofia', 'Dancing', 'Club', 500, 1.4, 14, 12, { mult: 1.0,  trend: 0.6 }, false],
  // SWEDEN — Stockholm
  ['Trädgården',      'stockholm', 'Dancing', 'Club', 2000, 1.2, 20, 18, { mult: 1.15, trend: 0.9 }, true],
  ['Under Bron',      'stockholm', 'Dancing', 'Club', 600,  2.0, 15, 15, { mult: 1.05, trend: 0.8 }, false],
  ['Berns',           'stockholm', 'Dancing', 'Club', 900,  1.2, 16, 18, { mult: 1.0,  trend: 0.6 }, true],
  ['Slakthuset',      'stockholm', 'Dancing', 'Club', 1000, 1.6, 17, 16, { mult: 1.05, trend: 0.7 }, false],
  // FINLAND — Helsinki
  ['Kaiku',           'helsinki', 'Dancing', 'Club', 500, 2.0, 14, 14, { mult: 1.05, trend: 0.8 }, true],
  ['Kuudes Linja',    'helsinki', 'Dancing', 'Club', 400, 2.0, 13, 13, { mult: 1.0,  trend: 0.8 }, false],
  ['Tiivistämö',      'helsinki', 'Dancing', 'Club', 500, 1.8, 13, 12, { mult: 1.0,  trend: 0.7 }, false],
  // NORWAY — Oslo
  ['Jaeger',          'oslo', 'Dancing', 'Club', 400, 2.0, 14, 15, { mult: 1.05, trend: 0.8 }, true],
  ['The Villa',       'oslo', 'Dancing', 'Club', 300, 2.0, 12, 14, { mult: 1.0,  trend: 0.8 }, false],
  ['Blå',             'oslo', 'Live',    'Venue',500, 1.0, 13, 12, { mult: 0.95, trend: 0.5 }, false],
  // IRELAND — Dublin
  ['Pygmalion',       'dublin', 'Dancing', 'Club', 400, 1.2, 14, 10, { mult: 1.0,  trend: 0.7 }, true],
  ['Copper Face Jacks','dublin', 'Dancing', 'Club', 800, 1.4, 16, 12, { mult: 1.05, trend: 0.7 }, true],
  ['Tengu',           'dublin', 'Dancing', 'Club', 400, 1.6, 13, 12, { mult: 1.0,  trend: 0.8 }, false],

  // ============ LGBTQ+ venues (marked with a rainbow flag on the map) ============
  // GREECE — Athens (Gazi) & Mykonos
  ['Sodade 2',         'gazi', 'Dancing', 'Club', 300, 1.2, 14, 10, { mult: 1.0,  trend: 0.7 }, true,  true],
  ['BeQueer',          'gazi', 'Dancing', 'Club', 250, 1.4, 12, 8,  { mult: 0.95, trend: 0.7 }, false, true],
  ["JackieO' Mykonos", 'mykonos-town', 'Cocktails', 'Club', 300, -0.3, 14, 15, { mult: 1.0, trend: 0.5 }, true,  true],
  ['Babylon Mykonos',  'mykonos-town', 'Bars', 'Bar', 200, -0.5, 11, 0, { mult: 0.9, trend: 0.3 }, false, true],
  // GERMANY — Berlin
  ['SchwuZ',           'kreuzberg', 'Dancing', 'Club', 600, 2.0, 16, 14, { mult: 1.05, trend: 0.8 }, true,  true],
  ['Lab.oratory',      'friedrichshain', 'Dancing', 'Club', 400, 2.4, 13, 18, { mult: 1.0, trend: 0.8 }, false, true],
  // FRANCE — Paris
  ['Le Dépôt',         'oberkampf', 'Dancing', 'Club', 500, 1.8, 15, 15, { mult: 1.05, trend: 0.8 }, true,  true],
  ['Raidd Bar',        'oberkampf', 'Bars', 'Bar', 200, 0.5, 12, 0, { mult: 0.95, trend: 0.6 }, false, true],
  // SPAIN — Barcelona & Madrid
  ['Arena Madre',      'poblenou', 'Dancing', 'Club', 400, 1.8, 15, 12, { mult: 1.05, trend: 0.8 }, true,  true],
  ['LL Show Bar',      'madrid-centro', 'Bars', 'Bar', 250, 1.0, 12, 0, { mult: 0.95, trend: 0.6 }, false, true],
  // PORTUGAL — Lisbon
  ['Trumps',           'lisbon', 'Dancing', 'Club', 500, 1.8, 15, 12, { mult: 1.05, trend: 0.8 }, true,  true],
  ['Finalmente Club',  'lisbon', 'Dancing', 'Club', 300, 2.0, 12, 10, { mult: 1.0, trend: 0.7 }, false, true],
  // ITALY — Milan & Rome
  ['Leccomilano',      'navigli', 'Bars', 'Bar', 250, 0.5, 12, 0, { mult: 0.9, trend: 0.6 }, true,  true],
  ['Coming Out',       'ostiense', 'Bars', 'Bar', 200, 0.3, 12, 0, { mult: 0.9, trend: 0.6 }, true,  true],
  // UK — London & Manchester
  ['Royal Vauxhall Tavern', 'central-london', 'Live', 'Venue', 300, 1.0, 13, 10, { mult: 0.95, trend: 0.6 }, true, true],
  ['Cruz 101',         'manchester', 'Dancing', 'Club', 400, 1.6, 14, 8, { mult: 1.0, trend: 0.7 }, true,  true],
  // NETHERLANDS — Amsterdam
  ['Club Church',      'amsterdam', 'Dancing', 'Club', 400, 2.0, 13, 12, { mult: 1.0, trend: 0.8 }, true,  true],
  // BELGIUM — Brussels
  ['Le Belgica',       'brussels', 'Bars', 'Bar', 200, 0.4, 12, 0, { mult: 0.9, trend: 0.6 }, true,  true],
  // AUSTRIA — Vienna
  ['Why Not',          'vienna', 'Dancing', 'Club', 300, 1.6, 12, 10, { mult: 1.0, trend: 0.7 }, true,  true],
  // SWITZERLAND — Zürich
  ['Barfüsser',        'zurich', 'Bars', 'Bar', 200, 0.3, 11, 0, { mult: 0.9, trend: 0.5 }, true,  true],
  // CZECHIA — Prague
  ['TerMix',           'stare-mesto-prg', 'Dancing', 'Club', 250, 1.8, 12, 8, { mult: 1.0, trend: 0.8 }, true,  true],
  // HUNGARY — Budapest
  ['AlterEgo',         'erzsebetvaros', 'Dancing', 'Club', 300, 1.6, 13, 10, { mult: 1.0, trend: 0.7 }, true,  true],
  // POLAND — Warsaw & Kraków
  ['Ramona',           'srodmiescie', 'Bars', 'Bar', 250, 0.6, 12, 0, { mult: 0.95, trend: 0.6 }, false, true],  // GERMANY — Munich, Hamburg, Frankfurt
  ['NY.Club',          'sonnenstrasse', 'Dancing', 'Club', 350, 1.6, 12, 10, { mult: 1.0, trend: 0.7 }, true, true],
  ['Wunderbar',        'hamburg-stpauli', 'Bars', 'Bar', 180, 0.4, 11, 0, { mult: 0.9, trend: 0.5 }, false, true],
  ["Lucky's Manhattan", 'frankfurt-city', 'Bars', 'Bar', 180, 0.4, 11, 0, { mult: 0.9, trend: 0.5 }, false, true],
  // UK — Glasgow, Birmingham, Leeds
  ['Polo Lounge',      'glasgow', 'Dancing', 'Club', 400, 1.4, 13, 8, { mult: 1.0, trend: 0.7 }, true, true],
  ['The Nightingale Club', 'birmingham', 'Dancing', 'Club', 600, 1.6, 15, 10, { mult: 1.05, trend: 0.8 }, true, true],
  ['Viaduct Showbar',  'leeds', 'Bars', 'Bar', 250, 0.6, 12, 0, { mult: 0.95, trend: 0.6 }, true, true],
  // FRANCE — Nice & Marseille
  ['Le Glam',          'nice', 'Dancing', 'Club', 300, 1.6, 12, 10, { mult: 1.0, trend: 0.7 }, true, true],
  ['Le Pulse',         'marseille', 'Bars', 'Bar', 200, 0.6, 12, 0, { mult: 0.95, trend: 0.7 }, false, true],
  // NETHERLANDS — Amsterdam  // SLOVENIA — Ljubljana
  ['Klub Tiffany',     'ljubljana', 'Dancing', 'Club', 300, 1.6, 12, 8, { mult: 1.0, trend: 0.7 }, true, true],

  // ============ WORLDWIDE ============
  // USA — New York
  ['House of Yes',        'nyc-bk',  'Dancing', 'Club', 500, 1.8, 18, 25, { mult: 1.1,  trend: 0.9 }, true],
  ['Elsewhere',           'nyc-bk',  'Dancing', 'Club', 600, 1.8, 17, 22, { mult: 1.1,  trend: 0.9 }, true],
  ['Good Room',           'nyc-bk',  'Dancing', 'Club', 400, 1.9, 14, 20, { mult: 1.0,  trend: 0.8 }, false],
  ['Le Bain',             'nyc-mnh', 'Rooftops','Rooftop', 300, 0.2, 12, 25, { mult: 0.95, trend: 0.5 }, true],
  ['Marquee New York',    'nyc-mnh', 'Dancing', 'Club', 600, 1.4, 16, 30, { mult: 1.05, trend: 0.6 }, false],
  // USA — Miami
  ['LIV',                 'miami-beach', 'Dancing', 'Club', 1200, 1.4, 24, 40, { mult: 1.15, trend: 0.8 }, true],
  // Story — permanently closed April 2023 (Miami Beach 2 AM liquor curfew; property sold). Removed.
  ['Club Space',          'miami-dt',    'Late Night', 'Club', 1500, 2.6, 24, 35, { mult: 1.2, trend: 1.0 }, true],
  ['E11EVEN',             'miami-dt',    'Late Night', 'Club', 1000, 2.8, 22, 40, { mult: 1.15, trend: 0.9 }, true],
  // USA — Los Angeles
  ['Sound Nightclub',     'la-hollywood', 'Dancing', 'Club', 500, 1.8, 16, 25, { mult: 1.05, trend: 0.8 }, true],
  ['Academy LA',          'la-hollywood', 'Dancing', 'Club', 900, 1.6, 18, 30, { mult: 1.1,  trend: 0.8 }, true],
  ['Avalon Hollywood',    'la-hollywood', 'Dancing', 'Club', 1200, 1.6, 18, 30, { mult: 1.1, trend: 0.7 }, false],
  // USA — Las Vegas
  ['Omnia',               'lv-strip', 'Dancing', 'Club', 2000, 1.2, 26, 55, { mult: 1.2,  trend: 0.7 }, true],
  ['XS Nightclub',        'lv-strip', 'Dancing', 'Club', 2000, 1.0, 26, 55, { mult: 1.2,  trend: 0.7 }, true],
  ['Hakkasan',            'lv-strip', 'Dancing', 'Club', 2500, 1.2, 24, 50, { mult: 1.15, trend: 0.6 }, false],
  // USA — Chicago
  ['Smartbar',            'chicago', 'Dancing', 'Club', 500, 1.8, 15, 20, { mult: 1.05, trend: 0.8 }, true],
  ['Spybar',              'chicago', 'Dancing', 'Club', 400, 2.0, 13, 20, { mult: 1.0,  trend: 0.8 }, false],
  // Canada — Montreal
  ['Stereo',              'montreal', 'Late Night', 'Club', 700, 2.8, 18, 20, { mult: 1.15, trend: 0.9 }, true],
  ['New City Gas',        'montreal', 'Dancing', 'Club', 2000, 1.4, 20, 25, { mult: 1.1,  trend: 0.7 }, false],
  // Canada — Toronto
  ['Rebel',               'toronto', 'Dancing', 'Club', 2500, 1.4, 22, 25, { mult: 1.15, trend: 0.7 }, true],
  ['Coda',                'toronto', 'Dancing', 'Club', 600, 1.8, 15, 18, { mult: 1.05, trend: 0.8 }, false],
  // Mexico — Mexico City
  ['Yu Yu',               'cdmx-roma', 'Dancing', 'Club', 300, 1.8, 14, 18, { mult: 1.05, trend: 0.9 }, true],
  ['Departamento',        'cdmx-roma', 'Dancing', 'Club', 400, 1.6, 14, 15, { mult: 1.05, trend: 0.8 }, false],
  ['Fünk Club',           'cdmx-roma', 'Dancing', 'Club', 500, 1.8, 15, 18, { mult: 1.05, trend: 0.8 }, false],
  // Central America
  ['Coco Bongo',          'cancun-zh', 'Dancing', 'Club', 1800, 1.2, 22, 60, { mult: 1.1,  trend: 0.6 }, true],
  ['Mandala',             'cancun-zh', 'Dancing', 'Club', 900,  1.4, 18, 45, { mult: 1.05, trend: 0.6 }, false],
  ['Papaya Playa Project','tulum', 'Dancing', 'Club', 800, 0.8, 16, 45, { mult: 1.05, trend: 0.7 }, true],
  ['Bonbonniere Tulum',   'tulum', 'Late Night', 'Club', 400, 2.2, 13, 40, { mult: 1.0, trend: 0.8 }, false],
  ['Teatro Amador',       'panama-casco', 'Dancing', 'Club', 500, 1.6, 14, 15, { mult: 1.05, trend: 0.8 }, true],
  ['Casa Jaguar',         'panama-casco', 'Bars',    'Bar', 250, 0.4, 11, 0,  { mult: 0.9,  trend: 0.4 }, false],
  ['Vértigo',             'sanjose-cr', 'Dancing', 'Club', 600, 1.6, 14, 15, { mult: 1.05, trend: 0.7 }, true],
  ['El Sótano',           'sanjose-cr', 'Live',    'Venue', 250, 0.4, 10, 8, { mult: 0.85, trend: 0.4 }, false],
  // South America — Brazil
  ['D-Edge',              'sao-paulo', 'Dancing', 'Club', 1500, 2.2, 22, 20, { mult: 1.2,  trend: 0.9 }, true],
  ['Audio',               'sao-paulo', 'Live',    'Venue', 2000, 1.0, 18, 22, { mult: 1.0,  trend: 0.6 }, false],
  ['Rio Scenarium',       'rio-lapa', 'Live',    'Venue', 800, 0.6, 14, 12, { mult: 0.95, trend: 0.5 }, true],
  ['Fosfobox',            'rio-lapa', 'Dancing', 'Club', 400, 1.8, 13, 14, { mult: 1.0,  trend: 0.8 }, false],
  // South America — Argentina
  ['Crobar',              'ba-palermo', 'Dancing', 'Club', 1500, 2.0, 20, 18, { mult: 1.15, trend: 0.8 }, true],
  ['Niceto Club',         'ba-palermo', 'Dancing', 'Club', 700, 1.8, 16, 15, { mult: 1.05, trend: 0.8 }, false],
  // South America — Colombia
  ['Theatron',            'bogota-chap', 'Dancing', 'Club', 5000, 1.6, 30, 15, { mult: 1.2, trend: 0.9 }, true, true],
  ['Baum',                'bogota-chap', 'Dancing', 'Club', 600, 2.0, 15, 14, { mult: 1.05, trend: 0.9 }, false],
  ['Salón Amador',        'medellin-pob', 'Dancing', 'Club', 500, 1.8, 15, 14, { mult: 1.05, trend: 0.8 }, true],
  ['Envy Rooftop',        'medellin-pob', 'Rooftops','Rooftop', 300, 0.2, 12, 12, { mult: 0.95, trend: 0.5 }, false],
  // South America — Peru & Chile
  ['Ayahuasca',           'lima-barranco', 'Cocktails', 'Bar', 300, 0.4, 12, 10, { mult: 0.95, trend: 0.5 }, true],
  ['Gótica',              'lima-barranco', 'Dancing', 'Club', 600, 1.6, 15, 15, { mult: 1.05, trend: 0.7 }, false],
  ['Club La Feria',       'santiago-bel', 'Dancing', 'Club', 500, 2.0, 14, 14, { mult: 1.05, trend: 0.8 }, true],
  ['Blondie',             'santiago-bel', 'Dancing', 'Club', 700, 1.6, 15, 12, { mult: 1.05, trend: 0.7 }, false],
  // Asia — Thailand
  ['Sing Sing Theater',   'bangkok-sukh', 'Dancing', 'Club', 500, 1.6, 15, 15, { mult: 1.05, trend: 0.8 }, true],  ['Levels Club',         'bangkok-sukh', 'Dancing', 'Club', 700, 1.6, 16, 18, { mult: 1.05, trend: 0.7 }, false],
  // Asia — Japan
  ['WOMB',                'tokyo-shibuya', 'Dancing', 'Club', 1000, 2.0, 18, 25, { mult: 1.15, trend: 0.9 }, true],
  ['Sound Museum Vision', 'tokyo-shibuya', 'Dancing', 'Club', 1500, 1.8, 20, 25, { mult: 1.1, trend: 0.8 }, true],
  ['V2 Tokyo',            'tokyo-roppongi','Dancing', 'Club', 800, 1.4, 16, 25, { mult: 1.05, trend: 0.7 }, false],
  ['Circus Osaka',        'osaka-namba', 'Dancing', 'Club', 400, 2.0, 13, 20, { mult: 1.05, trend: 0.9 }, true],
  ['Giraffe Osaka',       'osaka-namba', 'Dancing', 'Club', 700, 1.4, 15, 22, { mult: 1.05, trend: 0.7 }, false],
  // Asia — South Korea
  ['Cakeshop',            'seoul-itaewon', 'Dancing', 'Club', 400, 2.2, 15, 20, { mult: 1.1,  trend: 0.9 }, true],
  ['Soap Seoul',          'seoul-itaewon', 'Dancing', 'Club', 400, 2.2, 14, 20, { mult: 1.05, trend: 0.9 }, false],
  ['Octagon',             'seoul-gangnam', 'Dancing', 'Club', 1500, 1.8, 22, 30, { mult: 1.15, trend: 0.8 }, true],
  // Asia — Vietnam
  ['Lush Saigon',         'hcmc-d1', 'Dancing', 'Club', 400, 1.4, 13, 12, { mult: 1.0,  trend: 0.7 }, true],
  ['The Observatory',     'hcmc-d1', 'Dancing', 'Club', 500, 1.8, 14, 12, { mult: 1.05, trend: 0.8 }, false],
  ['Savage',              'hanoi-oq', 'Dancing', 'Club', 500, 1.8, 14, 10, { mult: 1.05, trend: 0.9 }, true],
  ['1900 Le Théâtre',     'hanoi-oq', 'Dancing', 'Club', 600, 1.4, 14, 10, { mult: 1.0,  trend: 0.7 }, false],
  // Asia — Indonesia (Bali)
  ['La Favela',           'bali-seminyak', 'Dancing', 'Club', 600, 1.4, 15, 12, { mult: 1.05, trend: 0.8 }, true],
  ['Mrs Sippy',           'bali-seminyak', 'Bars',    'Bar', 800, -0.4, 14, 15, { mult: 0.95, trend: 0.4 }, false],
  ['Savaya Bali',         'bali-canggu', 'Dancing', 'Club', 1200, 0.2, 18, 25, { mult: 1.05, trend: 0.6 }, true],
  ["Old Man's",           'bali-canggu', 'Bars',    'Bar', 700, -0.6, 12, 8, { mult: 0.9,  trend: 0.3 }, false],
  // Asia — Singapore
  ['Zouk Singapore',      'singapore', 'Dancing', 'Club', 1500, 1.6, 20, 25, { mult: 1.15, trend: 0.8 }, true],
  ['Marquee Singapore',   'singapore', 'Dancing', 'Club', 2000, 1.4, 20, 30, { mult: 1.1,  trend: 0.6 }, false],
  // Middle East
  ['White Dubai',         'dubai', 'Dancing', 'Club', 3000, 0.8, 24, 40, { mult: 1.1,  trend: 0.6 }, true],
  ['Soho Garden',         'dubai', 'Dancing', 'Club', 1500, 1.2, 18, 35, { mult: 1.05, trend: 0.6 }, false],
  ['The Block',           'telaviv', 'Dancing', 'Club', 700, 2.4, 18, 20, { mult: 1.15, trend: 0.9 }, true],
  ['Kuli Alma',           'telaviv', 'Dancing', 'Club', 400, 1.8, 14, 15, { mult: 1.0,  trend: 0.8 }, false],
  // Turkey
  ['Klein Phormat',       'istanbul-bey', 'Dancing', 'Club', 500, 2.0, 15, 15, { mult: 1.05, trend: 0.8 }, true],
  ['MiniMüzikhol',        'istanbul-bey', 'Dancing', 'Club', 350, 2.0, 13, 14, { mult: 1.0,  trend: 0.8 }, false],
  ['Kloster',             'istanbul-bey', 'Dancing', 'Club', 400, 1.8, 13, 14, { mult: 1.0,  trend: 0.7 }, false],
  // Belarus
  ['Hulahoop',            'minsk', 'Dancing', 'Club', 400, 1.6, 13, 8, { mult: 1.0,  trend: 0.7 }, true],
  ['Dozari',              'minsk', 'Dancing', 'Club', 600, 1.4, 14, 10, { mult: 1.0,  trend: 0.6 }, false],
  // Lithuania
  ['Opium Club',          'vilnius', 'Dancing', 'Club', 500, 1.8, 14, 10, { mult: 1.05, trend: 0.8 }, true],
  ['Kablys',              'vilnius', 'Dancing', 'Club', 600, 1.8, 14, 8, { mult: 1.05, trend: 0.8 }, false],
  // Latvia
  ['Piens',               'riga-lv', 'Dancing', 'Club', 400, 1.6, 13, 8, { mult: 1.0,  trend: 0.7 }, true],
  ['One One',             'riga-lv', 'Dancing', 'Club', 500, 1.6, 14, 10, { mult: 1.0,  trend: 0.7 }, false],
  // Estonia
  ['HALL',                'tallinn', 'Dancing', 'Club', 700, 2.0, 16, 12, { mult: 1.1,  trend: 0.9 }, true],
  ['Sveta Baar',          'tallinn', 'Bars',    'Bar', 250, 0.6, 11, 0, { mult: 0.9,  trend: 0.5 }, false],
  // Luxembourg
  ['Melusina',            'luxembourg', 'Dancing', 'Club', 500, 1.4, 13, 12, { mult: 1.0,  trend: 0.7 }, true],
  ['De Gudde Wëllen',     'luxembourg', 'Live',    'Venue', 300, 0.6, 11, 10, { mult: 0.9,  trend: 0.5 }, false],
  // Australia
  ['Ivy',                 'sydney', 'Dancing', 'Club', 2000, 1.2, 20, 22, { mult: 1.1,  trend: 0.6 }, true],
  ['Chinese Laundry',     'sydney', 'Dancing', 'Club', 600, 1.8, 15, 18, { mult: 1.05, trend: 0.8 }, false],
  ['Revolver Upstairs',   'melbourne', 'Late Night', 'Club', 500, 2.6, 15, 15, { mult: 1.1, trend: 0.9 }, true],
  ['Brown Alley',         'melbourne', 'Dancing', 'Club', 700, 1.8, 15, 15, { mult: 1.05, trend: 0.8 }, false],
  // Africa
  ['Era Club',            'capetown', 'Dancing', 'Club', 600, 1.6, 15, 12, { mult: 1.05, trend: 0.8 }, true],
  ['The Waiting Room',    'capetown', 'Bars',    'Bar', 250, 0.4, 11, 8, { mult: 0.9,  trend: 0.4 }, false],

  // ============ INDIA / CHINA / REST OF WORLD ============
  // INDIA
  ['Kitty Su Mumbai',     'mumbai', 'Dancing', 'Club', 600, 1.4, 16, 20, { mult: 1.05, trend: 0.7 }, true],
  ['antiSOCIAL Mumbai',   'mumbai', 'Dancing', 'Club', 400, 1.6, 14, 15, { mult: 1.05, trend: 0.8 }, false],
  ['Bonobo',              'mumbai', 'Bars',    'Bar', 200, 0.4, 11, 8, { mult: 0.9,  trend: 0.4 }, false],
  ['Kitty Su Delhi',      'delhi', 'Dancing', 'Club', 700, 1.4, 16, 20, { mult: 1.05, trend: 0.7 }, true],
  ['Summer House Cafe',   'delhi', 'Bars',    'Bar', 300, 0.6, 12, 10, { mult: 0.95, trend: 0.5 }, false],
  ['Church Street Social','bangalore', 'Bars', 'Bar', 250, 0.4, 12, 8, { mult: 0.95, trend: 0.5 }, true],
  ['Skyye Lounge',        'bangalore', 'Rooftops', 'Rooftop', 300, 0.2, 12, 12, { mult: 0.95, trend: 0.5 }, false],
  ['Club Cubana',         'goa', 'Dancing', 'Club', 800, 1.2, 16, 15, { mult: 1.05, trend: 0.7 }, true],
  ['Hilltop Goa',         'goa', 'Dancing', 'Club', 1500, 1.4, 18, 12, { mult: 1.1,  trend: 0.7 }, false],
  // CHINA + HONG KONG
  ['Bar Rouge',           'shanghai', 'Rooftops', 'Rooftop', 600, 1.0, 16, 25, { mult: 1.05, trend: 0.6 }, true],
  ['TAXX Shanghai',       'shanghai', 'Dancing', 'Club', 1000, 1.4, 20, 30, { mult: 1.1,  trend: 0.7 }, true],
  ['ALL Club',            'shanghai', 'Dancing', 'Club', 500, 2.0, 15, 20, { mult: 1.05, trend: 0.9 }, false],
  ['Lantern Club',        'beijing', 'Dancing', 'Club', 400, 2.0, 14, 15, { mult: 1.05, trend: 0.9 }, true],
  ['Dada Bar',            'beijing', 'Dancing', 'Club', 300, 1.8, 12, 12, { mult: 1.0,  trend: 0.8 }, false],
  ['TAG Chengdu',         'chengdu', 'Dancing', 'Club', 400, 2.0, 13, 15, { mult: 1.05, trend: 0.9 }, true],
  ['Space Plus Chengdu',  'chengdu', 'Dancing', 'Club', 900, 1.4, 17, 20, { mult: 1.1,  trend: 0.7 }, false],
  ['Dragon-i',            'hongkong', 'Dancing', 'Club', 500, 1.2, 15, 30, { mult: 1.05, trend: 0.6 }, true],
  ['Zentral',             'hongkong', 'Dancing', 'Club', 600, 1.4, 15, 30, { mult: 1.05, trend: 0.6 }, false],
  // REST OF ASIA
  ['OMNI Taipei',         'taipei', 'Dancing', 'Club', 900, 1.4, 17, 25, { mult: 1.1,  trend: 0.7 }, true],
  ['Wave Club',           'taipei', 'Dancing', 'Club', 600, 1.6, 14, 20, { mult: 1.05, trend: 0.7 }, false],
  ['Zouk Kuala Lumpur',   'kualalumpur', 'Dancing', 'Club', 800, 1.6, 17, 20, { mult: 1.1,  trend: 0.8 }, true],
  ["Marini's on 57",      'kualalumpur', 'Rooftops', 'Rooftop', 400, 0.0, 13, 25, { mult: 0.95, trend: 0.4 }, false],
  ['The Palace Manila',   'manila', 'Dancing', 'Club', 1200, 1.4, 18, 18, { mult: 1.1,  trend: 0.7 }, true],
  ['Time Manila',         'manila', 'Dancing', 'Club', 500, 2.0, 14, 15, { mult: 1.05, trend: 0.9 }, false],
  ['Colosseum Jakarta',   'jakarta', 'Dancing', 'Club', 1500, 1.4, 20, 20, { mult: 1.1,  trend: 0.7 }, true],
  ['Dragonfly Jakarta',   'jakarta', 'Dancing', 'Club', 700, 1.4, 15, 18, { mult: 1.05, trend: 0.6 }, false],
  // MIDDLE EAST / CAUCASUS
  ['B018',                'beirut', 'Late Night', 'Club', 500, 2.6, 16, 20, { mult: 1.15, trend: 0.9 }, true],
  ['The Grand Factory',   'beirut', 'Dancing', 'Club', 700, 2.0, 16, 20, { mult: 1.1,  trend: 0.8 }, false],
  ['Bassiani',            'tbilisi', 'Dancing', 'Club', 1200, 2.4, 20, 12, { mult: 1.2,  trend: 0.9 }, true],
  ['Khidi',               'tbilisi', 'Dancing', 'Club', 800, 2.4, 17, 12, { mult: 1.1,  trend: 0.9 }, false],
  // AFRICA
  ['Quilox',              'lagos', 'Dancing', 'Club', 1000, 1.6, 18, 25, { mult: 1.1,  trend: 0.8 }, true],
  ['Cubana Lagos',        'lagos', 'Dancing', 'Club', 500, 1.8, 14, 15, { mult: 1.05, trend: 0.8 }, false],
  ['B Club Nairobi',      'nairobi', 'Dancing', 'Club', 600, 1.6, 15, 15, { mult: 1.05, trend: 0.8 }, true],
  ['The Alchemist Bar',   'nairobi', 'Bars',    'Bar', 400, 0.6, 13, 8, { mult: 0.95, trend: 0.5 }, false],
  ['Theatro Marrakech',   'marrakech', 'Dancing', 'Club', 700, 1.4, 16, 25, { mult: 1.1,  trend: 0.7 }, true],
  ['Pacha Marrakech',     'marrakech', 'Dancing', 'Club', 3000, 1.2, 22, 30, { mult: 1.15, trend: 0.6 }, false],
  ['Cairo Jazz Club',     'cairo', 'Live',    'Venue', 400, 0.6, 13, 12, { mult: 0.95, trend: 0.5 }, true],
  ['The Tap East',        'cairo', 'Bars',    'Bar', 300, 0.4, 11, 8, { mult: 0.9,  trend: 0.4 }, false],
  ['And Club',            'joburg', 'Dancing', 'Club', 600, 1.8, 15, 12, { mult: 1.05, trend: 0.8 }, true],
  ['Kitcheners',          'joburg', 'Bars',    'Bar', 350, 0.8, 13, 6, { mult: 0.95, trend: 0.6 }, false],
  ['Twist Nightclub',     'accra', 'Dancing', 'Club', 500, 1.6, 14, 12, { mult: 1.05, trend: 0.8 }, true],
  ['Bloombar',            'accra', 'Bars',    'Bar', 250, 0.6, 11, 8, { mult: 0.9,  trend: 0.5 }, false],
  // NORTH AMERICA (more)
  ['1015 Folsom',         'sf', 'Dancing', 'Club', 1000, 1.6, 18, 25, { mult: 1.1,  trend: 0.8 }, true],
  ['The EndUp',           'sf', 'Late Night', 'Club', 400, 2.6, 14, 20, { mult: 1.05, trend: 0.9 }, false, true],
  ['TV Lounge',           'detroit', 'Dancing', 'Club', 400, 2.0, 14, 15, { mult: 1.1,  trend: 0.9 }, true],
  ['Spot Lite Detroit',   'detroit', 'Dancing', 'Club', 350, 2.0, 13, 12, { mult: 1.05, trend: 0.9 }, false],
  ['Echostage',           'dc', 'Dancing', 'Club', 3000, 1.4, 24, 30, { mult: 1.15, trend: 0.7 }, true],
  ['Flash',               'dc', 'Dancing', 'Club', 400, 2.0, 14, 18, { mult: 1.05, trend: 0.9 }, false],
  ['Kingdom',             'austin', 'Dancing', 'Club', 500, 1.8, 15, 15, { mult: 1.05, trend: 0.8 }, true],
  ['Barbarella',          'austin', 'Dancing', 'Club', 400, 1.6, 13, 12, { mult: 1.0,  trend: 0.7 }, false],
  ['Republic NOLA',       'neworleans', 'Live', 'Venue', 700, 1.0, 15, 15, { mult: 1.0,  trend: 0.6 }, true],
  ['The Maison',          'neworleans', 'Live', 'Venue', 300, 0.6, 12, 8, { mult: 0.9,  trend: 0.5 }, false],
  ['MJQ Concourse',       'atlanta', 'Dancing', 'Club', 500, 2.0, 15, 12, { mult: 1.05, trend: 0.9 }, true],
  ['District Atlanta',    'atlanta', 'Dancing', 'Club', 1500, 1.4, 20, 25, { mult: 1.1,  trend: 0.7 }, false],
  ['Celebrities',         'vancouver', 'Dancing', 'Club', 600, 1.6, 15, 15, { mult: 1.05, trend: 0.7 }, true],
  ['Twelve West',         'vancouver', 'Dancing', 'Club', 500, 1.6, 14, 18, { mult: 1.05, trend: 0.7 }, false],
  // LATIN AMERICA / CARIBBEAN (more)
  ['Phonotheque',         'montevideo', 'Dancing', 'Club', 500, 2.2, 15, 12, { mult: 1.05, trend: 0.9 }, true],
  ['La Trastienda MVD',   'montevideo', 'Live', 'Venue', 600, 0.8, 13, 10, { mult: 0.95, trend: 0.5 }, false],
  ['Bazurto Social Club', 'cartagena', 'Live', 'Venue', 400, 1.0, 14, 12, { mult: 1.0,  trend: 0.7 }, true],
  ['Café Havana',         'cartagena', 'Live', 'Venue', 350, 1.0, 13, 12, { mult: 0.95, trend: 0.6 }, false],
  ['Fábrica de Arte Cubano','havana', 'Live', 'Venue', 1500, 0.8, 18, 10, { mult: 1.05, trend: 0.6 }, true],
  ['Casa de la Música',   'havana', 'Live', 'Venue', 600, 0.6, 14, 10, { mult: 0.95, trend: 0.5 }, false],
  ['La Factoría',         'sanjuan', 'Cocktails', 'Bar', 250, 0.4, 12, 8, { mult: 0.95, trend: 0.5 }, true],
  ['Club Brava',          'sanjuan', 'Dancing', 'Club', 700, 1.4, 16, 20, { mult: 1.05, trend: 0.7 }, false],
  // OCEANIA (more)
  ['Family Nightclub',    'brisbane', 'Dancing', 'Club', 1200, 1.6, 18, 18, { mult: 1.1,  trend: 0.8 }, true],
  ['The Met',             'brisbane', 'Dancing', 'Club', 800, 1.4, 15, 15, { mult: 1.05, trend: 0.7 }, false],
  ['Ambar',               'perth', 'Dancing', 'Club', 500, 1.8, 14, 15, { mult: 1.05, trend: 0.8 }, true],
  ['Villa Perth',         'perth', 'Dancing', 'Club', 500, 1.6, 13, 15, { mult: 1.0,  trend: 0.7 }, false],
  ['Cassette Nine',       'auckland', 'Dancing', 'Club', 400, 1.6, 13, 12, { mult: 1.0,  trend: 0.8 }, true],
  ['Impala Auckland',     'auckland', 'Dancing', 'Club', 400, 1.8, 13, 12, { mult: 1.0,  trend: 0.8 }, false],
  // EUROPE (gaps)
  ['Kaffibarinn',         'reykjavik', 'Bars',    'Bar', 200, 0.6, 12, 8, { mult: 0.95, trend: 0.6 }, true],
  ['Prikið',              'reykjavik', 'Bars',    'Bar', 200, 0.8, 11, 8, { mult: 0.9,  trend: 0.6 }, false],
  ['Closer',              'kyiv', 'Dancing', 'Club', 600, 2.2, 16, 12, { mult: 1.1,  trend: 0.9 }, true],
  ['K41',                 'kyiv', 'Dancing', 'Club', 800, 2.4, 17, 12, { mult: 1.1,  trend: 0.9 }, false],
  ['Tvornica Kulture',    'zagreb', 'Dancing', 'Club', 800, 1.6, 16, 12, { mult: 1.05, trend: 0.8 }, true],
  ['Katran',              'zagreb', 'Dancing', 'Club', 700, 2.0, 15, 10, { mult: 1.05, trend: 0.8 }, false],

  // ============ LGBTQ+ BARS & CLUBS WORLDWIDE ============
  // format: [name, hood, category, kind, cap, peakOffset, peakRate, price, sim, verified, lgbtq, ig]
  // North America
  ['The Q NYC',           'nyc-mnh', 'Dancing', 'Club', 500, 1.6, 15, 20, { mult: 1.05, trend: 0.8 }, true,  true, 'theqnyc'],
  ['Industry Bar',        'nyc-mnh', 'Bars',    'Bar', 250, 0.6, 12, 0, { mult: 0.95, trend: 0.5 }, false, true],
  ['Twist',               'miami-beach', 'Dancing', 'Club', 500, 1.8, 15, 0, { mult: 1.05, trend: 0.7 }, true, true, 'twistsobe'],
  ['The Abbey',           'la-hollywood', 'Dancing', 'Club', 600, 1.2, 15, 0, { mult: 1.05, trend: 0.6 }, true, true, 'theabbeyweho'],
  ["Micky's WeHo",        'la-hollywood', 'Dancing', 'Club', 350, 1.4, 13, 0, { mult: 1.0,  trend: 0.6 }, false, true],
  ['Oasis',               'sf', 'Dancing', 'Club', 400, 1.6, 13, 15, { mult: 1.0, trend: 0.7 }, true, true, 'sfoasis'],
  ['Sidetrack',           'chicago', 'Bars', 'Bar', 500, 1.0, 14, 0, { mult: 1.0, trend: 0.6 }, true, true, 'sidetrackchicago'],
  ["Woody's Toronto",     'toronto', 'Bars', 'Bar', 400, 1.0, 13, 0, { mult: 0.95, trend: 0.5 }, true, true, 'woodystoronto'],
  ['Kinky Bar',           'cdmx-roma', 'Dancing', 'Club', 500, 1.6, 14, 12, { mult: 1.05, trend: 0.8 }, false, true],
  // South America
  ['The Week São Paulo',  'sao-paulo', 'Dancing', 'Club', 3000, 1.8, 24, 25, { mult: 1.2, trend: 0.9 }, true, true, 'theweekbrasil'],
  ['Amerika',             'ba-palermo', 'Dancing', 'Club', 2000, 2.2, 22, 15, { mult: 1.15, trend: 0.9 }, true, true],
  // Europe
  ['Club NYX',            'amsterdam', 'Dancing', 'Club', 600, 1.6, 15, 15, { mult: 1.05, trend: 0.8 }, true, true, 'clubnyxamsterdam'],
  ['Club 33 Madrid',      'madrid-centro', 'Dancing', 'Club', 400, 1.6, 13, 12, { mult: 1.0, trend: 0.7 }, false, true],
  // Asia / Oceania / Africa / Middle East
  ['DJ Station',          'bangkok-sukh', 'Dancing', 'Club', 600, 1.8, 15, 12, { mult: 1.1, trend: 0.8 }, true, true],
  ['GOD Bangkok',         'bangkok-sukh', 'Late Night', 'Club', 500, 2.6, 14, 12, { mult: 1.05, trend: 0.9 }, false, true],
  ['AiSOTOPE Lounge',     'tokyo-nichome', 'Dancing', 'Club', 300, 1.8, 12, 18, { mult: 1.0, trend: 0.8 }, true, true],
  ['Arty Farty',          'tokyo-nichome', 'Bars', 'Bar', 200, 1.4, 11, 0, { mult: 0.95, trend: 0.7 }, false, true],
  ['Trance Seoul',        'seoul-itaewon', 'Dancing', 'Club', 300, 1.8, 12, 15, { mult: 1.0, trend: 0.8 }, true, true],
  ['Café Dalida',         'taipei', 'Bars', 'Bar', 250, 1.0, 12, 0, { mult: 0.95, trend: 0.6 }, false, true],
  ['Tantric Bar',         'singapore', 'Bars', 'Bar', 300, 0.8, 13, 0, { mult: 0.95, trend: 0.5 }, true, true],
  ['O Bar Manila',        'manila', 'Dancing', 'Club', 500, 1.8, 14, 15, { mult: 1.05, trend: 0.8 }, true, true, 'obarmanila'],
  ['Lucca 390',           'shanghai', 'Dancing', 'Club', 400, 1.6, 13, 15, { mult: 1.0, trend: 0.7 }, false, true],
  ['Shpagat',             'telaviv', 'Bars', 'Bar', 250, 1.0, 12, 0, { mult: 0.95, trend: 0.6 }, false, true],
  ['Stonewall Hotel',     'sydney', 'Dancing', 'Club', 500, 1.2, 14, 0, { mult: 1.0, trend: 0.6 }, true, true, 'stonewallhotel'],
  ['The Peel',            'melbourne', 'Dancing', 'Club', 400, 1.4, 13, 0, { mult: 1.0, trend: 0.6 }, false, true],
  ['Crew Bar',            'capetown', 'Dancing', 'Club', 400, 1.6, 13, 10, { mult: 1.0, trend: 0.7 }, true, true, 'crewbarcapetown'],

  // ============ EXPANSION: RUSSIA / C.ASIA / MORE AFRICA / BRAZIL COAST / CHINA / EE / SA ============
  // Russia
  ['Mutabor',             'moscow', 'Dancing', 'Club', 2000, 2.4, 22, 20, { mult: 1.2,  trend: 0.9 }, true],
  ['Propaganda',          'moscow', 'Dancing', 'Club', 500, 1.8, 14, 12, { mult: 1.05, trend: 0.7 }, false],
  ['Blank',               'spb', 'Dancing', 'Club', 700, 2.4, 15, 12, { mult: 1.1,  trend: 0.9 }, true],
  ['Griboedov',           'spb', 'Dancing', 'Club', 400, 1.8, 13, 10, { mult: 1.0,  trend: 0.8 }, false],
  // Central Asia + Caucasus
  ['Ministerstvo',        'tashkent', 'Dancing', 'Club', 500, 1.6, 14, 12, { mult: 1.05, trend: 0.7 }, true],
  ['Chocolate Club',      'tashkent', 'Dancing', 'Club', 400, 1.4, 12, 10, { mult: 1.0,  trend: 0.6 }, false],
  ['Esperanza',           'almaty', 'Dancing', 'Club', 600, 1.6, 14, 12, { mult: 1.05, trend: 0.7 }, true],
  ['Barmaley',            'almaty', 'Bars',    'Bar', 250, 0.6, 11, 0, { mult: 0.9,  trend: 0.5 }, false],
  ['Otto Baku',           'baku', 'Bars',    'Bar', 300, 0.8, 12, 10, { mult: 0.95, trend: 0.5 }, true],
  ['Eleven Club',         'baku', 'Dancing', 'Club', 500, 1.6, 14, 15, { mult: 1.05, trend: 0.6 }, false],
  ['Poligraph',           'yerevan', 'Dancing', 'Club', 400, 1.8, 13, 10, { mult: 1.05, trend: 0.8 }, true],
  ['Pinta Pub',           'yerevan', 'Bars',    'Bar', 250, 0.6, 11, 0, { mult: 0.9,  trend: 0.5 }, false],
  // Africa (more)
  ['Duplex Dakar',        'dakar', 'Dancing', 'Club', 600, 1.6, 15, 12, { mult: 1.05, trend: 0.8 }, true],
  ['La Villa',            'dakar', 'Bars',    'Bar', 300, 0.8, 12, 8, { mult: 0.9,  trend: 0.5 }, false],
  ['Le Living',           'casablanca', 'Dancing', 'Club', 700, 1.4, 16, 20, { mult: 1.1,  trend: 0.7 }, true],
  ['Cabana Beach',        'casablanca', 'Bars',    'Bar', 500, -0.4, 13, 15, { mult: 0.95, trend: 0.4 }, false],
  ['Gaslight',            'addis', 'Dancing', 'Club', 500, 1.6, 14, 12, { mult: 1.05, trend: 0.7 }, true],
  ['Flirt Lounge',        'addis', 'Bars',    'Bar', 300, 0.8, 12, 8, { mult: 0.9,  trend: 0.5 }, false],
  ['Origin Nightclub',    'durban', 'Dancing', 'Club', 600, 1.6, 15, 12, { mult: 1.05, trend: 0.8 }, true],
  ['The Winston',         'durban', 'Live',    'Venue', 300, 0.8, 12, 8, { mult: 0.9,  trend: 0.5 }, false],
  // China (more)
  ['Oil Club',            'shenzhen', 'Dancing', 'Club', 600, 2.0, 15, 18, { mult: 1.1,  trend: 0.9 }, true],
  ['Pepper Club',         'shenzhen', 'Dancing', 'Club', 700, 1.4, 16, 20, { mult: 1.05, trend: 0.6 }, false],
  ['Arkham',              'shanghai', 'Dancing', 'Club', 500, 2.0, 14, 18, { mult: 1.05, trend: 0.9 }, true],
  ['Zhao Dai',            'beijing', 'Dancing', 'Club', 400, 2.2, 13, 15, { mult: 1.05, trend: 0.9 }, true],
  // Brazil coast — world-famous
  ['Green Valley',        'camboriu', 'Dancing', 'Club', 8000, 1.2, 30, 40, { mult: 1.2, trend: 0.9 }, true],
  ['Warung Beach Club',   'camboriu', 'Dancing', 'Club', 3000, 0.8, 24, 35, { mult: 1.15, trend: 0.8 }, true],
  // South America (more, existing cities)
  ['Cine Joia',           'sao-paulo', 'Live',    'Venue', 900, 0.8, 16, 15, { mult: 1.0,  trend: 0.6 }, false],
  ['The Week Rio',        'rio-lapa', 'Dancing', 'Club', 2000, 1.8, 22, 25, { mult: 1.15, trend: 0.8 }, true, true, 'theweekbrasil'],
  ['Leviano Bar',         'rio-lapa', 'Live',    'Venue', 400, 0.8, 13, 10, { mult: 0.95, trend: 0.6 }, false],
  ['Bahrein',             'ba-palermo', 'Dancing', 'Club', 700, 2.0, 16, 15, { mult: 1.1,  trend: 0.8 }, true],
  ['Jet BA',              'ba-palermo', 'Dancing', 'Club', 900, 1.4, 16, 18, { mult: 1.05, trend: 0.6 }, false],
  ['Kaputt',              'bogota-chap', 'Dancing', 'Club', 500, 1.8, 14, 14, { mult: 1.05, trend: 0.8 }, true],
  ['Armando Records',     'bogota-chap', 'Dancing', 'Club', 600, 1.4, 15, 14, { mult: 1.05, trend: 0.6 }, false],
  ['Perro Negro',         'medellin-pob', 'Dancing', 'Club', 500, 1.8, 14, 12, { mult: 1.05, trend: 0.8 }, true],
  ['Club Chocolate',      'santiago-bel', 'Dancing', 'Club', 600, 1.6, 15, 12, { mult: 1.05, trend: 0.7 }, true],
  // Eastern Europe (more, existing cities)
  ['Jasna 1',             'srodmiescie', 'Dancing', 'Club', 500, 2.0, 15, 12, { mult: 1.1,  trend: 0.9 }, true],
  ['Tama',                'poznan-centrum', 'Dancing', 'Club', 600, 1.6, 15, 10, { mult: 1.05, trend: 0.8 }, true],
  ['Ankali',              'stare-mesto-prg', 'Dancing', 'Club', 500, 2.2, 14, 10, { mult: 1.1,  trend: 0.9 }, true],
  ['Lärm',                'erzsebetvaros', 'Dancing', 'Club', 400, 2.2, 13, 10, { mult: 1.1,  trend: 0.9 }, true],
  ['Guesthouse',          'lipscani', 'Dancing', 'Club', 400, 1.8, 13, 8, { mult: 1.05, trend: 0.8 }, true],
  ['Kvaka 22',            'savamala', 'Dancing', 'Club', 400, 2.0, 13, 8, { mult: 1.05, trend: 0.9 }, true],
  ['Otel',                'kyiv', 'Dancing', 'Club', 500, 2.2, 14, 10, { mult: 1.1,  trend: 0.9 }, true],
  // Latvia + Estonia (more)
  ['Nabaklab',            'riga-lv', 'Bars',    'Bar', 300, 1.0, 12, 6, { mult: 0.95, trend: 0.6 }, false],
  ['Depo',                'riga-lv', 'Dancing', 'Club', 500, 1.8, 14, 8, { mult: 1.05, trend: 0.8 }, true],
  ['Club Hollywood',      'tallinn', 'Dancing', 'Club', 700, 1.4, 15, 12, { mult: 1.05, trend: 0.6 }, false],

  // ─── USA — TEXAS ───────────────────────────────────────────────
  // Houston
  ['Bauhaus',             'houston-mid', 'Dancing', 'Club', 500,  2.0, 14, 15, { mult: 1.05, trend: 0.9 }, false],
  ['Numbers',             'houston-mid', 'Dancing', 'Club', 600,  1.8, 13, 10, { mult: 1.0,  trend: 0.7 }, false],
  // Dallas — Deep Ellum
  ['Club Dada',           'dallas-de', 'Live',    'Venue', 500, 1.4, 13, 10, { mult: 1.0,  trend: 0.7 }, false],
  ['Vidorra',             'dallas-de', 'Rooftops','Rooftop', 400, 1.2, 13, 10, { mult: 1.0, trend: 0.7 }, false],
  ["It'll Do Club",       'dallas-de', 'Dancing', 'Club', 400, 2.0, 13, 12, { mult: 1.05, trend: 0.9 }, false],
  ['The Nines',           'dallas-de', 'Bars',    'Bar', 350, 1.4, 12, 8, { mult: 0.95, trend: 0.6 }, false],
  // San Antonio
  ['HEAT Nightclub',      'sanantonio-dt', 'Dancing', 'Club', 500, 1.6, 14, 10, { mult: 1.0, trend: 0.8 }, false, true],
  ['Paper Tiger',         'sanantonio-dt', 'Live',    'Venue', 500, 1.4, 13, 12, { mult: 1.0, trend: 0.7 }, false],
  ['Midnight Swim',       'sanantonio-dt', 'Cocktails','Bar', 180, 0.6, 11, 0, { mult: 0.9, trend: 0.6 }, false],

  // ─── CENTRAL AMERICA ───────────────────────────────────────────
  // Guatemala City — Zona Viva
  ['Bajo Fondo',          'guatemala-zv', 'Dancing', 'Club', 400, 1.8, 13, 8, { mult: 1.0, trend: 0.8 }, false],
  ['Trovajazz',           'guatemala-zv', 'Live',    'Venue', 150, 0.8, 11, 6, { mult: 0.9, trend: 0.5 }, false],
  ["Shakespeare's Pub",   'guatemala-zv', 'Bars',    'Bar', 150, 0.4, 11, 0, { mult: 0.9, trend: 0.5 }, false],
  // San Salvador — Zona Rosa
  ['Republik',            'sansalvador-zr', 'Dancing','Club', 400, 1.6, 13, 10, { mult: 1.0, trend: 0.8 }, false],
  ['Insomnia Club',       'sansalvador-zr', 'Dancing','Club', 350, 1.8, 12, 10, { mult: 1.0, trend: 0.8 }, false],
  // Panama City — Casco Viejo (more; Teatro Amador already listed)
  ['CasaCasco',           'panama-casco', 'Dancing', 'Club', 500, 1.4, 14, 15, { mult: 1.0, trend: 0.7 }, false],

  // ─── GREECE — NAFPLIO ──────────────────────────────────────────
  ['Ydragogio',           'nafplio-old', 'Cocktails','Bar', 150, 0.6, 11, 0, { mult: 0.9, trend: 0.5 }, false],
  ['Rosso Music Cafe',    'nafplio-old', 'Live',    'Venue', 150, 0.8, 11, 0, { mult: 0.9, trend: 0.5 }, false],

  // ─── PARTY / HOLIDAY RESORTS ───────────────────────────────────
  // Albufeira (Algarve)
  ['Kiss Club',           'albufeira-strip', 'Dancing', 'Club', 1500, 2.0, 18, 15, { mult: 1.1,  trend: 0.9 }, true],
  ['Libertos',            'albufeira-strip', 'Dancing', 'Club', 800,  1.8, 15, 12, { mult: 1.05, trend: 0.8 }, false],
  // Zakynthos (Laganas)
  ['Rescue Club',         'laganas', 'Dancing', 'Club', 2000, 2.2, 18, 12, { mult: 1.1,  trend: 0.9 }, true],
  ['Cocktails and Dreams','laganas', 'Bars',    'Bar', 500, 1.8, 14, 8, { mult: 1.0, trend: 0.8 }, false],
  // Magaluf (Mallorca)
  ['BCM Planet Dance',    'magaluf-strip', 'Dancing', 'Club', 7000, 2.0, 20, 20, { mult: 1.15, trend: 0.9 }, true],
  ["Tokio Joe's",         'magaluf-strip', 'Dancing', 'Club', 800, 2.0, 15, 12, { mult: 1.05, trend: 0.8 }, false],
  // Malia (Crete)
  ['Zig Zag Club',        'malia-strip', 'Dancing', 'Club', 900, 2.0, 16, 10, { mult: 1.05, trend: 0.9 }, false],
  ['Candy Club',          'malia-strip', 'Dancing', 'Club', 500, 1.8, 13, 8, { mult: 1.0, trend: 0.8 }, false],
  // Ayia Napa (Cyprus)
  ['The Castle Club',     'ayianapa', 'Dancing', 'Club', 4000, 2.2, 20, 15, { mult: 1.15, trend: 0.9 }, true],
  ['Bed Rock',            'ayianapa', 'Bars',    'Bar', 400, 1.6, 13, 8, { mult: 1.0, trend: 0.7 }, false],
  // Sunny Beach (Bulgaria)
  ['Cacao Beach Club',    'sunnybeach', 'Dancing', 'Club', 3000, 1.4, 18, 12, { mult: 1.1,  trend: 0.8 }, true],
  ['Bedroom Beach',       'sunnybeach', 'Dancing', 'Club', 1500, 1.2, 15, 12, { mult: 1.05, trend: 0.7 }, false],
  // Lebanon — Beirut (more)
  ['AHM',                 'beirut', 'Dancing', 'Club', 600, 2.4, 16, 20, { mult: 1.1,  trend: 0.9 }, false],
  ['Ballroom Blitz',      'beirut', 'Dancing', 'Club', 700, 2.2, 16, 20, { mult: 1.1,  trend: 0.9 }, false],

  // ─── PARTY RESORTS (more) ──────────────────────────────────────
  // Zakynthos / Laganas
  ['Waikiki',             'laganas', 'Dancing', 'Club', 800, 2.2, 15, 10, { mult: 1.05, trend: 0.9 }, false],
  // Albufeira
  ['Club Vida',           'albufeira-strip', 'Dancing', 'Club', 900, 2.0, 15, 12, { mult: 1.05, trend: 0.8 }, false],
  ['Club Tropicana',      'albufeira-strip', 'Bars',    'Bar', 500, 1.8, 14, 8, { mult: 1.0, trend: 0.8 }, false],
  ['Club Heaven',         'albufeira-strip', 'Dancing', 'Club', 1500, 2.0, 15, 12, { mult: 1.05, trend: 0.8 }, false],
  // Ayia Napa
  ['Black N White',       'ayianapa', 'Dancing', 'Club', 600, 2.0, 14, 10, { mult: 1.0, trend: 0.8 }, false],
  ['Carwash',             'ayianapa', 'Dancing', 'Club', 700, 1.8, 14, 12, { mult: 1.0, trend: 0.7 }, false],
  // Sunny Beach
  // Malia
  ['Apollo Club',         'malia-strip', 'Dancing', 'Club', 900, 2.2, 15, 8, { mult: 1.05, trend: 0.9 }, false],
  // Magaluf
  // --- discovered from Google Places ---
  ['The Villa', 'durban', 'Dancing', 'Club', 400, 0, 11, 10, { mult: 1, trend: 0.6 }, true],
  ['Envy Nightclub', 'durban', 'Dancing', 'Club', 400, 0, 8, 30, { mult: 1, trend: 0.6 }, true],
  ['Koko Bar', 'durban', 'Dancing', 'Club', 400, 0, 12, 10, { mult: 1, trend: 0.6 }, true],
  // --- discovered from Google Places ---
  ['Plot', 'accra', 'Dancing', 'Club', 400, 0, 14, 10, { mult: 1, trend: 0.6 }, true],
  ['KRUNA The Club', 'accra', 'Dancing', 'Club', 400, 0, 12, 30, { mult: 1, trend: 0.6 }, true],
  ['Hotgossip Night Club', 'accra', 'Dancing', 'Club', 400, 0, 11, 10, { mult: 1, trend: 0.6 }, true],
  ['Club H2O | Hayahulet | ክለብ ኤች ቱ ኦ | ሀያ ሁለት', 'addis', 'Dancing', 'Club', 400, 0, 10, 10, { mult: 1, trend: 0.6 }, true],
  ['The wave club & lounge', 'addis', 'Dancing', 'Club', 400, 0, 8, 18, { mult: 1, trend: 0.6 }, true],
  ['V Lounge Addis | wollo sefer | ቪ ላዉንጅ አዲስ | ወሎ ሰፈር', 'addis', 'Dancing', 'Club', 400, 0, 11, 18, { mult: 1, trend: 0.6 }, true],
  ['Tantsy', 'almaty', 'Dancing', 'Club', 400, 0, 15, 10, { mult: 1, trend: 0.6 }, true],
  ['Стриптиз бар KAZANOVA', 'almaty', 'Dancing', 'Club', 400, 0, 11, 18, { mult: 1, trend: 0.6 }, true],
  ['Barcode Almaty', 'almaty', 'Dancing', 'Club', 400, 0, 12, 10, { mult: 1, trend: 0.6 }, true],
  ['Club Lima', 'antwerp', 'Dancing', 'Club', 400, 0, 15, 10, { mult: 1, trend: 0.6 }, true],
  ['House of Madison', 'antwerp', 'Dancing', 'Club', 400, 0, 8, 10, { mult: 1, trend: 0.6 }, true],
  ['Club Vaag', 'antwerp', 'Dancing', 'Club', 400, 0, 14, 10, { mult: 1, trend: 0.6 }, true],
  ['Insomnia Nightclub', 'atlanta', 'Dancing', 'Club', 400, 0, 16, 5, { mult: 1, trend: 0.6 }, true],
  ['Royal Peacock Lounge', 'atlanta', 'Dancing', 'Club', 400, 0, 15, 10, { mult: 1, trend: 0.6 }, true],
  ['Havana Nightclub ATL', 'atlanta', 'Dancing', 'Club', 400, 0, 15, 10, { mult: 1, trend: 0.6 }, true],
  ['Sapphire Nightclub', 'auckland', 'Dancing', 'Club', 400, 0, 11, 10, { mult: 1, trend: 0.6 }, true],
  ['Orange Nightclub', 'auckland', 'Dancing', 'Club', 400, 0, 8, 10, { mult: 1, trend: 0.6 }, true],
  ['Face Club', 'auckland', 'Dancing', 'Club', 400, 0, 12, 10, { mult: 1, trend: 0.6 }, true],
  ['Twins Nightclub', 'austin', 'Dancing', 'Club', 400, 0, 8, 10, { mult: 1, trend: 0.6 }, true],
  ['Mala Fama', 'austin', 'Dancing', 'Club', 400, 0, 11, 10, { mult: 1, trend: 0.6 }, true],
  ['Elysium', 'austin', 'Dancing', 'Club', 400, 0, 14, 5, { mult: 1, trend: 0.6 }, true],
  ['4 Play showclub', 'ayianapa', 'Dancing', 'Club', 400, 0, 13, 30, { mult: 1, trend: 0.6 }, true],
  ['Ellips club', 'baku', 'Dancing', 'Club', 400, 0, 8, 30, { mult: 1, trend: 0.6 }, true],
  ['Extra Night Club', 'baku', 'Dancing', 'Club', 400, 0, 14, 30, { mult: 1, trend: 0.6 }, true],
  ['Pasifico Lounge and Dining', 'baku', 'Dancing', 'Club', 400, 0, 13, 10, { mult: 1, trend: 0.6 }, true],
  ['Atlas Super Club', 'bali-canggu', 'Dancing', 'Club', 400, 0, 17, 30, { mult: 1, trend: 0.6 }, true],
  ['Nolimmits Lounge & Club', 'bangalore', 'Dancing', 'Club', 400, 0, 19, 30, { mult: 1, trend: 0.6 }, true],
  ['JB Arena (Just BLR)', 'bangalore', 'Dancing', 'Club', 400, 0, 18, 30, { mult: 1, trend: 0.6 }, true],
  ['Drunken Daddy', 'bangalore', 'Dancing', 'Club', 400, 0, 20, 10, { mult: 1, trend: 0.6 }, true],
  ['404 Club Not Found Bangkok', 'bangkok-sukh', 'Dancing', 'Club', 400, 0, 13, 30, { mult: 1, trend: 0.6 }, true],
  ['Mix Club', 'beijing', 'Dancing', 'Club', 400, 0, 10, 30, { mult: 1, trend: 0.6 }, true],
  ['Vics', 'beijing', 'Dancing', 'Club', 400, 0, 10, 10, { mult: 1, trend: 0.6 }, true],
  ['La Scène Beirut', 'beirut', 'Dancing', 'Club', 400, 0, 13, 30, { mult: 1, trend: 0.6 }, true],
  ['Club Lux', 'belfast', 'Dancing', 'Club', 400, 0, 12, 10, { mult: 1, trend: 0.6 }, true],
  ['Voodoo', 'belfast', 'Dancing', 'Club', 400, 0, 16, 10, { mult: 1, trend: 0.6 }, true],
  ['Ollie\'s Belfast', 'belfast', 'Dancing', 'Club', 400, 0, 11, 10, { mult: 1, trend: 0.6 }, true],
  ['Hype Belgrade Night Club', 'savamala', 'Dancing', 'Club', 400, 0, 15, 30, { mult: 1, trend: 0.6 }, true],
  ['XOYO Birmingham', 'birmingham', 'Dancing', 'Club', 400, 0, 13, 10, { mult: 1, trend: 0.6 }, true],
  ['Erotic night club', 'bogota-chap', 'Dancing', 'Club', 400, 0, 9, 30, { mult: 1, trend: 0.6 }, true],
  ['The Club Bratislava', 'stare-mesto-ba', 'Dancing', 'Club', 400, 0, 17, 10, { mult: 1, trend: 0.6 }, true],
  ['Channels Club', 'stare-mesto-ba', 'Dancing', 'Club', 400, 0, 17, 10, { mult: 1, trend: 0.6 }, true],
  ['Mi Casa Nightclub Brisbane', 'brisbane', 'Dancing', 'Club', 400, 0, 13, 10, { mult: 1, trend: 0.6 }, true],
  ['Sugar Nightclub', 'brisbane', 'Dancing', 'Club', 400, 0, 10, 10, { mult: 1, trend: 0.6 }, true],
  ['Eclipse Brisbane', 'brisbane', 'Dancing', 'Club', 400, 0, 11, 10, { mult: 1, trend: 0.6 }, true],
  ['CIRCUIT Bristol', 'bristol', 'Dancing', 'Club', 400, 0, 14, 10, { mult: 1, trend: 0.6 }, true],
  ['Sawmills', 'bristol', 'Dancing', 'Club', 400, 0, 10, 10, { mult: 1, trend: 0.6 }, true],
  ['FLASH Club', 'brussels', 'Dancing', 'Club', 400, 0, 13, 10, { mult: 1, trend: 0.6 }, true],
  ['Mirano Brussels', 'brussels', 'Dancing', 'Club', 400, 0, 16, 10, { mult: 1, trend: 0.6 }, true],
  ['Omnia', 'budva', 'Dancing', 'Club', 400, 0, 15, 10, { mult: 1, trend: 0.6 }, true],
  ['Premium Palazzo night club', 'budva', 'Dancing', 'Club', 400, 0, 13, 10, { mult: 1, trend: 0.6 }, true],
  ['Perla Club', 'budva', 'Dancing', 'Club', 400, 0, 10, 10, { mult: 1, trend: 0.6 }, true],
  ['ECHO Prive', 'cairo', 'Dancing', 'Club', 400, 0, 12, 30, { mult: 1, trend: 0.6 }, true],
  ['Disco cash cairo by Magnum Nights', 'cairo', 'Dancing', 'Club', 400, 0, 12, 30, { mult: 1, trend: 0.6 }, true],
  ['Xo Club Nightclub Cairo', 'cairo', 'Dancing', 'Club', 400, 0, 14, 30, { mult: 1, trend: 0.6 }, true],
  ['Red Club BC', 'camboriu', 'Dancing', 'Club', 400, 0, 10, 30, { mult: 1, trend: 0.6 }, true],
  ['Shed Club Balneário Camboriú', 'camboriu', 'Dancing', 'Club', 400, 0, 12, 30, { mult: 1, trend: 0.6 }, true],
  ['Prime Lounge Bar', 'camboriu', 'Dancing', 'Club', 400, 0, 12, 10, { mult: 1, trend: 0.6 }, true],
  ['H Roof', 'cancun-zh', 'Dancing', 'Club', 400, 0, 14, 30, { mult: 1, trend: 0.6 }, true],
  ['CRAB NIGHT CLUB', 'cancun-zh', 'Dancing', 'Club', 400, 0, 12, 10, { mult: 1, trend: 0.6 }, true],
  ['MÜN Nightclub', 'cancun-zh', 'Dancing', 'Club', 400, 0, 11, 30, { mult: 1, trend: 0.6 }, true],
  ['HALO Nightclub ‐ CPT', 'capetown', 'Dancing', 'Club', 400, 0, 12, 10, { mult: 1, trend: 0.6 }, true],
  ['Club Paradise', 'capetown', 'Dancing', 'Club', 400, 0, 11, 10, { mult: 1, trend: 0.6 }, true],
  ['Mary\'s Cardiff', 'cardiff', 'Dancing', 'Club', 400, 0, 14, 10, { mult: 1, trend: 0.6 }, true],
  ['Popworld - Cardiff', 'cardiff', 'Dancing', 'Club', 400, 0, 14, 10, { mult: 1, trend: 0.6 }, true],
  ['CIRCUIT Cardiff', 'cardiff', 'Dancing', 'Club', 400, 0, 15, 10, { mult: 1, trend: 0.6 }, true],
  ['Taboo Disco Club', 'cartagena', 'Dancing', 'Club', 400, 0, 18, 10, { mult: 1, trend: 0.6 }, true],
  ['La Movida Cartagena', 'cartagena', 'Dancing', 'Club', 400, 0, 18, 10, { mult: 1, trend: 0.6 }, true],
  ['EIVISSA CARTAGENA', 'cartagena', 'Dancing', 'Club', 400, 0, 15, 10, { mult: 1, trend: 0.6 }, true],
  ['Yellow CLUB', 'casablanca', 'Dancing', 'Club', 400, 0, 14, 30, { mult: 1, trend: 0.6 }, true],
  ['Maison B', 'casablanca', 'Dancing', 'Club', 400, 0, 14, 30, { mult: 1, trend: 0.6 }, true],
  ['VANITY POOL CLUB', 'casablanca', 'Dancing', 'Club', 400, 0, 10, 10, { mult: 1, trend: 0.6 }, true],
  ['DNA Night Club', 'chania-old', 'Dancing', 'Club', 400, 0, 12, 10, { mult: 1, trend: 0.6 }, true],
  ['Senso Club', 'chania-old', 'Dancing', 'Club', 400, 0, 14, 10, { mult: 1, trend: 0.6 }, true],
  ['PRYSM Chicago', 'chicago', 'Dancing', 'Club', 400, 0, 15, 10, { mult: 1, trend: 0.6 }, true],
  ['HunkOMania Chicago', 'chicago', 'Dancing', 'Club', 400, 0, 10, 10, { mult: 1, trend: 0.6 }, true],
  ['Edgo Night Club', 'chisinau-centru', 'Dancing', 'Club', 400, 0, 14, 30, { mult: 1, trend: 0.6 }, true],
  ['The Secret Club', 'chisinau-centru', 'Dancing', 'Club', 400, 0, 10, 10, { mult: 1, trend: 0.6 }, true],
  ['Platinum Club Cologne', 'cologne-city', 'Dancing', 'Club', 400, 0, 10, 10, { mult: 1, trend: 0.6 }, true],
  ['Vanity Club Cologne - Köln', 'cologne-city', 'Dancing', 'Club', 400, 0, 14, 10, { mult: 1, trend: 0.6 }, true],
  ['Club "Bollwerk Cologne"', 'cologne-city', 'Dancing', 'Club', 400, 0, 11, 10, { mult: 1, trend: 0.6 }, true],
  ['Werkstatt', 'copenhagen', 'Dancing', 'Club', 400, 0, 10, 10, { mult: 1, trend: 0.6 }, true],
  ['Zefside', 'copenhagen', 'Dancing', 'Club', 400, 0, 13, 10, { mult: 1, trend: 0.6 }, true],
  ['Edem Beach Club', 'corfu-town', 'Dancing', 'Club', 400, 0, 14, 18, { mult: 1, trend: 0.6 }, true],
  ['Havana Club Corfu Ipsos', 'corfu-town', 'Dancing', 'Club', 400, 0, 12, 10, { mult: 1, trend: 0.6 }, true],
  ['Avalon', 'corfu-town', 'Dancing', 'Club', 400, 0, 13, 10, { mult: 1, trend: 0.6 }, true],
  ['Le Chic Restaurant & Night club', 'dakar', 'Dancing', 'Club', 400, 0, 8, 10, { mult: 1, trend: 0.6 }, true],
  ['Vogue Super Night Club', 'dakar', 'Dancing', 'Club', 400, 0, 11, 10, { mult: 1, trend: 0.6 }, true],
  ['ZANZIBAR Dakar NIGHT-CLUB', 'dakar', 'Dancing', 'Club', 400, 0, 10, 10, { mult: 1, trend: 0.6 }, true],
  ['Rokwood Nightclub and Bar', 'dallas-de', 'Dancing', 'Club', 400, 0, 12, 5, { mult: 1, trend: 0.6 }, true],
  ['The Club Delhi', 'delhi', 'Dancing', 'Club', 400, 0, 13, 10, { mult: 1, trend: 0.6 }, true],
  ['Epic Restro Bar', 'delhi', 'Dancing', 'Club', 400, 0, 18, 10, { mult: 1, trend: 0.6 }, true],
  ['Slique delhi', 'delhi', 'Dancing', 'Club', 400, 0, 13, 30, { mult: 1, trend: 0.6 }, true],
  ['Society Detroit', 'detroit', 'Dancing', 'Club', 400, 0, 11, 10, { mult: 1, trend: 0.6 }, true],
  ['Annex Nightclub', 'detroit', 'Dancing', 'Club', 400, 0, 12, 10, { mult: 1, trend: 0.6 }, true],
  ['Deluxx Fluxx', 'detroit', 'Dancing', 'Club', 400, 0, 14, 5, { mult: 1, trend: 0.6 }, true],
  ['Omni Club Dubai Night club', 'dubai', 'Dancing', 'Club', 400, 0, 16, 30, { mult: 1, trend: 0.6 }, true],
  ['Club One Dubai', 'dubai', 'Dancing', 'Club', 400, 0, 13, 10, { mult: 1, trend: 0.6 }, true],
  ['My Table Dubai', 'dubai', 'Dancing', 'Club', 400, 0, 8, 30, { mult: 1, trend: 0.6 }, true],
  ['Twenty Two', 'dublin', 'Dancing', 'Club', 400, 0, 14, 18, { mult: 1, trend: 0.6 }, true],
  ['Dicey\'s Garden', 'dublin', 'Dancing', 'Club', 400, 0, 17, 10, { mult: 1, trend: 0.6 }, true],
  ['Westside Rodeo', 'edinburgh', 'Dancing', 'Club', 400, 0, 14, 10, { mult: 1, trend: 0.6 }, true],
  ['The Voodoo Rooms', 'edinburgh', 'Dancing', 'Club', 400, 0, 17, 10, { mult: 1, trend: 0.6 }, true],
  ['Velvet', 'frankfurt-city', 'Dancing', 'Club', 400, 0, 16, 10, { mult: 1, trend: 0.6 }, true],
  ['le PANTHER', 'frankfurt-city', 'Dancing', 'Club', 400, 0, 14, 18, { mult: 1, trend: 0.6 }, true],
  ['The Baroque Club - Geneva', 'geneva', 'Dancing', 'Club', 400, 0, 13, 30, { mult: 1, trend: 0.6 }, true],
  ['Petit Palace', 'geneva', 'Dancing', 'Club', 400, 0, 14, 10, { mult: 1, trend: 0.6 }, true],
  ['VIP Oriental', 'geneva', 'Dancing', 'Club', 400, 0, 11, 10, { mult: 1, trend: 0.6 }, true],
  ['Hot Club Gent', 'ghent', 'Dancing', 'Club', 400, 0, 17, 10, { mult: 1, trend: 0.6 }, true],
  ['Club 69', 'ghent', 'Dancing', 'Club', 400, 0, 10, 10, { mult: 1, trend: 0.6 }, true],
  ['Niche Club', 'ghent', 'Dancing', 'Club', 400, 0, 9, 10, { mult: 1, trend: 0.6 }, true],
  ['142B Lounge Nightclub', 'glasgow', 'Dancing', 'Club', 400, 0, 11, 10, { mult: 1, trend: 0.6 }, true],
  ['Club Titos', 'goa', 'Dancing', 'Club', 400, 0, 20, 30, { mult: 1, trend: 0.6 }, true],
  ['VAGALUMME Nightclub', 'goa', 'Dancing', 'Club', 400, 0, 17, 30, { mult: 1, trend: 0.6 }, true],
  ['SOHO GOA', 'goa', 'Dancing', 'Club', 400, 0, 15, 30, { mult: 1, trend: 0.6 }, true],
  ['Karma Night Life • Zona 10', 'guatemala-zv', 'Dancing', 'Club', 400, 0, 10, 10, { mult: 1, trend: 0.6 }, true],
  ['The Box Lounge Groove', 'guatemala-zv', 'Dancing', 'Club', 400, 0, 13, 10, { mult: 1, trend: 0.6 }, true],
  ['GeizClub - Nightclub Hamburg Sxx 59', 'hamburg-stpauli', 'Dancing', 'Club', 400, 0, 13, 10, { mult: 1, trend: 0.6 }, true],
  ['Hero Club', 'hanoi-oq', 'Dancing', 'Club', 400, 0, 17, 10, { mult: 1, trend: 0.6 }, true],
  ['1900 Club Hanoi', 'hanoi-oq', 'Dancing', 'Club', 400, 0, 18, 10, { mult: 1, trend: 0.6 }, true],
  ['SHARK CLUB', 'hanoi-oq', 'Dancing', 'Club', 400, 0, 12, 10, { mult: 1, trend: 0.6 }, true],
  ['Tropicana Club', 'havana', 'Dancing', 'Club', 400, 0, 14, 10, { mult: 1, trend: 0.6 }, true],
  ['Habana Café', 'havana', 'Dancing', 'Club', 400, 0, 11, 10, { mult: 1, trend: 0.6 }, true],
  ['Cabaret Las Vegas', 'havana', 'Dancing', 'Club', 400, 0, 9, 10, { mult: 1, trend: 0.6 }, true],
  ['The PALM', 'helsinki', 'Dancing', 'Club', 400, 0, 11, 10, { mult: 1, trend: 0.6 }, true],
  ['Shot Bar Helsinki', 'helsinki', 'Dancing', 'Club', 400, 0, 13, 10, { mult: 1, trend: 0.6 }, true],
  ['Bofor Music Stage', 'chandakos', 'Dancing', 'Club', 400, 0, 10, 10, { mult: 1, trend: 0.6 }, true],
  ['Senses Club', 'chandakos', 'Dancing', 'Club', 400, 0, 16, 10, { mult: 1, trend: 0.6 }, true],
  ['Apocalypse Now', 'hcmc-d1', 'Dancing', 'Club', 400, 0, 12, 10, { mult: 1, trend: 0.6 }, true],
  ['KÉN SKYBAR', 'hcmc-d1', 'Dancing', 'Club', 400, 0, 11, 10, { mult: 1, trend: 0.6 }, true],
  ['Canalis Club', 'hcmc-d1', 'Dancing', 'Club', 400, 0, 17, 30, { mult: 1, trend: 0.6 }, true],
  ['Shuffle', 'hongkong', 'Dancing', 'Club', 400, 0, 13, 30, { mult: 1, trend: 0.6 }, true],
  ['OMA', 'hongkong', 'Dancing', 'Club', 400, 0, 10, 10, { mult: 1, trend: 0.6 }, true],
  ['BOOMERANG • The Illusionist', 'hongkong', 'Dancing', 'Club', 400, 0, 12, 10, { mult: 1, trend: 0.6 }, true],
  ['Dome Nightclub', 'houston-mid', 'Dancing', 'Club', 400, 0, 14, 30, { mult: 1, trend: 0.6 }, true],
  ['The Encore', 'houston-mid', 'Dancing', 'Club', 400, 0, 14, 10, { mult: 1, trend: 0.6 }, true],
  ['Sekai', 'houston-mid', 'Dancing', 'Club', 400, 0, 12, 10, { mult: 1, trend: 0.6 }, true],
  ['Central Park Club, Hvar', 'hvar', 'Dancing', 'Club', 400, 0, 15, 10, { mult: 1, trend: 0.6 }, true],
  ['Night club Romance', 'hvar', 'Dancing', 'Club', 400, 0, 11, 30, { mult: 1, trend: 0.6 }, true],
  ['PASSA CLUB HVAR', 'hvar', 'Dancing', 'Club', 400, 0, 10, 10, { mult: 1, trend: 0.6 }, true],
  ['Pink Champagne Hvar', 'hvar', 'Dancing', 'Club', 400, 0, 13, 10, { mult: 1, trend: 0.6 }, true],
  ['Swag Ibiza Club', 'ibiza', 'Dancing', 'Club', 400, 0, 15, 10, { mult: 1, trend: 0.6 }, true],
  ['Hï Ibiza', 'ibiza', 'Dancing', 'Club', 400, 0, 19, 30, { mult: 1, trend: 0.6 }, true],
  ['Escape Club İstanbul', 'istanbul-bey', 'Dancing', 'Club', 400, 0, 20, 10, { mult: 1, trend: 0.6 }, true],
  ['Ritim Roof (Teras)', 'istanbul-bey', 'Dancing', 'Club', 400, 0, 18, 10, { mult: 1, trend: 0.6 }, true],
  ['The H Club SCBD', 'jakarta', 'Dancing', 'Club', 400, 0, 15, 30, { mult: 1, trend: 0.6 }, true],
  ['The Escape Jakarta', 'jakarta', 'Dancing', 'Club', 400, 0, 14, 30, { mult: 1, trend: 0.6 }, true],
  ['Vault Jakarta', 'jakarta', 'Dancing', 'Club', 400, 0, 16, 30, { mult: 1, trend: 0.6 }, true],
  ['Razzmatazz Nightclub and Beer Garden', 'joburg', 'Dancing', 'Club', 400, 0, 8, 10, { mult: 1, trend: 0.6 }, true],
  ['Kong Club Rosebank', 'joburg', 'Dancing', 'Club', 400, 0, 10, 10, { mult: 1, trend: 0.6 }, true],
  ['Club H2O Smile', 'joburg', 'Dancing', 'Club', 400, 0, 10, 10, { mult: 1, trend: 0.6 }, true],
  ['Shine Club Kraków', 'krakow-stare', 'Dancing', 'Club', 400, 0, 19, 10, { mult: 1, trend: 0.6 }, true],
  ['La Bodega del Ron', 'krakow-stare', 'Dancing', 'Club', 400, 0, 17, 10, { mult: 1, trend: 0.6 }, true],
  ['Mojitos Social Nights', 'krakow-stare', 'Dancing', 'Club', 400, 0, 16, 10, { mult: 1, trend: 0.6 }, true],
  ['kyō kuala lumpur', 'kualalumpur', 'Dancing', 'Club', 400, 0, 16, 10, { mult: 1, trend: 0.6 }, true],
  ['Secret Club KL', 'kualalumpur', 'Dancing', 'Club', 400, 0, 8, 30, { mult: 1, trend: 0.6 }, true],
  ['Millennium Club', 'kualalumpur', 'Dancing', 'Club', 400, 0, 12, 30, { mult: 1, trend: 0.6 }, true],
  ['Club Rio', 'kyiv', 'Dancing', 'Club', 400, 0, 11, 10, { mult: 1, trend: 0.6 }, true],
  ['FIFTY. Hip-Hop & R\'n\'B Club', 'kyiv', 'Dancing', 'Club', 400, 0, 15, 10, { mult: 1, trend: 0.6 }, true],
  ['Club 57', 'lagos', 'Dancing', 'Club', 400, 0, 9, 10, { mult: 1, trend: 0.6 }, true],
  ['ZAZA Lagos', 'lagos', 'Dancing', 'Club', 400, 0, 15, 30, { mult: 1, trend: 0.6 }, true],
  ['Vaniti Lagos', 'lagos', 'Dancing', 'Club', 400, 0, 16, 30, { mult: 1, trend: 0.6 }, true],
  ['Drai\'s After Hours Las Vegas', 'lv-strip', 'Dancing', 'Club', 400, 0, 18, 10, { mult: 1, trend: 0.6 }, true],
  ['Marquee Nightclub', 'lv-strip', 'Dancing', 'Club', 400, 0, 16, 30, { mult: 1, trend: 0.6 }, true],
  ['Home Nightclub Leeds', 'leeds', 'Dancing', 'Club', 400, 0, 10, 10, { mult: 1, trend: 0.6 }, true],
  ['Darkflower GmbH - Leipzig', 'leipzig-city', 'Dancing', 'Club', 400, 0, 15, 10, { mult: 1, trend: 0.6 }, true],
  ['Metropolis Table Dance (Lounge - Leipzig', 'leipzig-city', 'Dancing', 'Club', 400, 0, 11, 10, { mult: 1, trend: 0.6 }, true],
  ['Club N39', 'leipzig-city', 'Dancing', 'Club', 400, 0, 11, 10, { mult: 1, trend: 0.6 }, true],
  ['Club 69', 'lima-barranco', 'Dancing', 'Club', 400, 0, 11, 30, { mult: 1, trend: 0.6 }, true],
  ['ValeTodo DownTown', 'lima-barranco', 'Dancing', 'Club', 400, 0, 16, 10, { mult: 1, trend: 0.6 }, true],
  ['Nebula', 'lima-barranco', 'Dancing', 'Club', 400, 0, 14, 10, { mult: 1, trend: 0.6 }, true],
  ['LEVEL Nightclub Liverpool', 'liverpool', 'Dancing', 'Club', 400, 0, 12, 10, { mult: 1, trend: 0.6 }, true],
  ['Heebie Jeebies', 'liverpool', 'Dancing', 'Club', 400, 0, 12, 10, { mult: 1, trend: 0.6 }, true],
  ['Night club Escape Ljubljana', 'ljubljana', 'Dancing', 'Club', 400, 0, 9, 30, { mult: 1, trend: 0.6 }, true],
  ['Dreams night club Luxembourg', 'luxembourg', 'Dancing', 'Club', 400, 0, 8, 30, { mult: 1, trend: 0.6 }, true],
  ['MILADY Palace', 'luxembourg', 'Dancing', 'Club', 400, 0, 8, 30, { mult: 1, trend: 0.6 }, true],
  ['Ground', 'luxembourg', 'Dancing', 'Club', 400, 0, 10, 10, { mult: 1, trend: 0.6 }, true],
  ['Loft Club Lyon', 'lyon', 'Dancing', 'Club', 400, 0, 17, 10, { mult: 1, trend: 0.6 }, true],
  ['Azar Club', 'lyon', 'Dancing', 'Club', 400, 0, 17, 10, { mult: 1, trend: 0.6 }, true],
  ['Queen club', 'lyon', 'Dancing', 'Club', 400, 0, 15, 10, { mult: 1, trend: 0.6 }, true],
  ['L\'Ambassade Club Lyon', 'lyon', 'Dancing', 'Club', 400, 0, 10, 10, { mult: 1, trend: 0.6 }, true],
  ['BCM Mallorca', 'magaluf-strip', 'Dancing', 'Club', 400, 0, 16, 18, { mult: 1, trend: 0.6 }, true],
  ['Night flight', 'magaluf-strip', 'Dancing', 'Club', 400, 0, 13, 10, { mult: 1, trend: 0.6 }, true],
  ['Red Lion Magaluf', 'magaluf-strip', 'Dancing', 'Club', 400, 0, 12, 5, { mult: 1, trend: 0.6 }, true],
  ['LUX CLUB Malia', 'malia-strip', 'Dancing', 'Club', 400, 0, 8, 10, { mult: 1, trend: 0.6 }, true],
  ['Original Bar', 'malia-strip', 'Dancing', 'Club', 400, 0, 10, 10, { mult: 1, trend: 0.6 }, true],
  ['Nuba Beach Club', 'mamaia', 'Dancing', 'Club', 400, 0, 14, 30, { mult: 1, trend: 0.6 }, true],
  ['Princess Summer Club & Beach Mamaia', 'mamaia', 'Dancing', 'Club', 400, 0, 17, 10, { mult: 1, trend: 0.6 }, true],
  ['Royal Makati', 'manila', 'Dancing', 'Club', 400, 0, 16, 10, { mult: 1, trend: 0.6 }, true],
  ['OCTOPUS', 'manila', 'Dancing', 'Club', 400, 0, 16, 10, { mult: 1, trend: 0.6 }, true],
  ['BABOUCHKA', 'marrakech', 'Dancing', 'Club', 400, 0, 18, 30, { mult: 1, trend: 0.6 }, true],
  ['555 Famous Club Marrakech -Discothèque-Boîte de nuit', 'marrakech', 'Dancing', 'Club', 400, 0, 15, 30, { mult: 1, trend: 0.6 }, true],
  ['SECRET ROOM MARRAKECH - Discothèque - Boîte de nuit', 'marrakech', 'Dancing', 'Club', 400, 0, 14, 30, { mult: 1, trend: 0.6 }, true],
  ['Pop Club', 'marseille', 'Dancing', 'Club', 400, 0, 13, 10, { mult: 1, trend: 0.6 }, true],
  ['Baby Club - Marseille', 'marseille', 'Dancing', 'Club', 400, 0, 15, 10, { mult: 1, trend: 0.6 }, true],
  ['La Isla Club', 'medellin-pob', 'Dancing', 'Club', 400, 0, 14, 30, { mult: 1, trend: 0.6 }, true],
  ['Gusto Night Club', 'medellin-pob', 'Dancing', 'Club', 400, 0, 11, 10, { mult: 1, trend: 0.6 }, true],
  ['District 1 Melbourne - #FridaysAreForD1', 'melbourne', 'Dancing', 'Club', 400, 0, 14, 10, { mult: 1, trend: 0.6 }, true],
  ['Club Retro', 'melbourne', 'Dancing', 'Club', 400, 0, 15, 10, { mult: 1, trend: 0.6 }, true],
  ['Patrick Miller', 'cdmx-roma', 'Dancing', 'Club', 400, 0, 17, 5, { mult: 1, trend: 0.6 }, true],
  ['Club M2 Miami', 'miami-beach', 'Dancing', 'Club', 400, 0, 14, 30, { mult: 1, trend: 0.6 }, true],
  ['Venus Club Milano', 'navigli', 'Dancing', 'Club', 400, 0, 11, 30, { mult: 1, trend: 0.6 }, true],
  ['Bobino Milano', 'navigli', 'Dancing', 'Club', 400, 0, 17, 10, { mult: 1, trend: 0.6 }, true],
  ['Black House Club', 'minsk', 'Dancing', 'Club', 400, 0, 11, 10, { mult: 1, trend: 0.6 }, true],
  ['TNT Rock Club', 'minsk', 'Dancing', 'Club', 400, 0, 18, 10, { mult: 1, trend: 0.6 }, true],
  ['Madmen', 'minsk', 'Dancing', 'Club', 400, 0, 13, 10, { mult: 1, trend: 0.6 }, true],
  ['Lotus Club', 'montevideo', 'Dancing', 'Club', 400, 0, 15, 10, { mult: 1, trend: 0.6 }, true],
  ['Baires', 'montevideo', 'Dancing', 'Club', 400, 0, 9, 10, { mult: 1, trend: 0.6 }, true],
  ['Il Tempo', 'montevideo', 'Dancing', 'Club', 400, 0, 16, 10, { mult: 1, trend: 0.6 }, true],
  ['Caché', 'montreal', 'Dancing', 'Club', 400, 0, 16, 10, { mult: 1, trend: 0.6 }, true],
  ['Palazo', 'montreal', 'Dancing', 'Club', 400, 0, 18, 10, { mult: 1, trend: 0.6 }, true],
  ['Muzique', 'montreal', 'Dancing', 'Club', 400, 0, 16, 10, { mult: 1, trend: 0.6 }, true],
  ['Strip Club Zazhigalka (Moscow)', 'moscow', 'Dancing', 'Club', 400, 0, 11, 30, { mult: 1, trend: 0.6 }, true],
  ['Lookin Rooms', 'moscow', 'Dancing', 'Club', 400, 0, 15, 10, { mult: 1, trend: 0.6 }, true],
  ['Bar Disko 90', 'moscow', 'Dancing', 'Club', 400, 0, 11, 10, { mult: 1, trend: 0.6 }, true],
  ['Shiloh Bar & Experience', 'mumbai', 'Dancing', 'Club', 400, 0, 15, 30, { mult: 1, trend: 0.6 }, true],
  ['Dragonfly Experience Mumbai', 'mumbai', 'Dancing', 'Club', 400, 0, 18, 30, { mult: 1, trend: 0.6 }, true],
  ['Queens Tabledance & Nightclub', 'sonnenstrasse', 'Dancing', 'Club', 400, 0, 14, 10, { mult: 1, trend: 0.6 }, true],
  ['Neuraum', 'sonnenstrasse', 'Dancing', 'Club', 400, 0, 18, 10, { mult: 1, trend: 0.6 }, true],
  ['Emporio', 'nafplio-old', 'Dancing', 'Club', 400, 0, 8, 10, { mult: 1, trend: 0.6 }, true],
  ['Black Cat', 'nafplio-old', 'Dancing', 'Club', 400, 0, 16, 10, { mult: 1, trend: 0.6 }, true],
  ['Allotino Coffee & Bar', 'nafplio-old', 'Bars', 'Bar', 180, 0, 17, 10, { mult: 1, trend: 0.6 }, true],
  ['K1 Klub House', 'nairobi', 'Dancing', 'Club', 400, 0, 17, 10, { mult: 1, trend: 0.6 }, true],
  ['BLACK STARS Club & Lounge', 'nairobi', 'Dancing', 'Club', 400, 0, 13, 10, { mult: 1, trend: 0.6 }, true],
  ['Black Samurai Lounge', 'nairobi', 'Dancing', 'Club', 400, 0, 14, 10, { mult: 1, trend: 0.6 }, true],
  ['The Rabbit Hole', 'neworleans', 'Dancing', 'Club', 400, 0, 12, 10, { mult: 1, trend: 0.6 }, true],
  ['Treehouse', 'neworleans', 'Dancing', 'Club', 400, 0, 14, 30, { mult: 1, trend: 0.6 }, true],
  ['The Dungeon', 'neworleans', 'Dancing', 'Club', 400, 0, 17, 5, { mult: 1, trend: 0.6 }, true],
  ['Tup Tup Palace', 'newcastle', 'Dancing', 'Club', 400, 0, 13, 10, { mult: 1, trend: 0.6 }, true],
  ['Popworld - Newcastle', 'newcastle', 'Dancing', 'Club', 400, 0, 14, 10, { mult: 1, trend: 0.6 }, true],
  ['Flares - Newcastle', 'newcastle', 'Dancing', 'Club', 400, 0, 15, 10, { mult: 1, trend: 0.6 }, true],
  ['OMA CLUB', 'nice', 'Dancing', 'Club', 400, 0, 14, 10, { mult: 1, trend: 0.6 }, true],
  ['Social club (speakeasy)', 'nice', 'Dancing', 'Club', 400, 0, 8, 10, { mult: 1, trend: 0.6 }, true],
  ['L’Oméga Club - Nice', 'nice', 'Dancing', 'Club', 400, 0, 13, 10, { mult: 1, trend: 0.6 }, true],
  ['Cocomo Club', 'zrce', 'Dancing', 'Club', 400, 0, 17, 10, { mult: 1, trend: 0.6 }, true],
  ['Kalypso', 'zrce', 'Dancing', 'Club', 400, 0, 13, 10, { mult: 1, trend: 0.6 }, true],
  ['Beach Bar Bridge', 'zrce', 'Dancing', 'Club', 400, 0, 11, 10, { mult: 1, trend: 0.6 }, true],
  ['Pure', 'osaka-namba', 'Dancing', 'Club', 400, 0, 15, 10, { mult: 1, trend: 0.6 }, true],
  ['SIDE:K OSAKA', 'osaka-namba', 'Dancing', 'Club', 400, 0, 14, 10, { mult: 1, trend: 0.6 }, true],
  ['THE PINK', 'osaka-namba', 'Dancing', 'Club', 400, 0, 18, 10, { mult: 1, trend: 0.6 }, true],
  ['Ingensteds', 'oslo', 'Dancing', 'Club', 400, 0, 13, 10, { mult: 1, trend: 0.6 }, true],
  ['Jæger', 'oslo', 'Dancing', 'Club', 400, 0, 13, 10, { mult: 1, trend: 0.6 }, true],
  ['La Mayor Night Club', 'panama-casco', 'Dancing', 'Club', 400, 0, 10, 10, { mult: 1, trend: 0.6 }, true],
  ['Red Club Panama', 'panama-casco', 'Dancing', 'Club', 400, 0, 8, 10, { mult: 1, trend: 0.6 }, true],
  ['Mod\'s Club', 'riga', 'Dancing', 'Club', 400, 0, 10, 10, { mult: 1, trend: 0.6 }, true],
  ['Saint Club', 'riga', 'Dancing', 'Club', 400, 0, 11, 10, { mult: 1, trend: 0.6 }, true],
  ['The Vault', 'perth', 'Dancing', 'Club', 400, 0, 11, 10, { mult: 1, trend: 0.6 }, true],
  ['Magnet House Night Club', 'perth', 'Dancing', 'Club', 400, 0, 13, 10, { mult: 1, trend: 0.6 }, true],
  ['Penthouse Club Perth', 'perth', 'Dancing', 'Club', 400, 0, 13, 30, { mult: 1, trend: 0.6 }, true],
  ['Lust Porto', 'porto', 'Dancing', 'Club', 400, 0, 15, 18, { mult: 1, trend: 0.6 }, true],
  ['Space Night Club - Stripclub Porto', 'porto', 'Dancing', 'Club', 400, 0, 9, 10, { mult: 1, trend: 0.6 }, true],
  ['Moreclub, Lda.', 'porto', 'Dancing', 'Club', 400, 0, 15, 10, { mult: 1, trend: 0.6 }, true],
  ['Słodownia Club', 'poznan-centrum', 'Dancing', 'Club', 400, 0, 8, 10, { mult: 1, trend: 0.6 }, true],
  ['The Club Number One Gentlemen\'s Club', 'poznan-centrum', 'Dancing', 'Club', 400, 0, 12, 30, { mult: 1, trend: 0.6 }, true],
  ['Nowe Lokum Stonewall', 'poznan-centrum', 'Dancing', 'Club', 400, 0, 15, 10, { mult: 1, trend: 0.6 }, true],
  ['Pacha Poznań', 'poznan-centrum', 'Dancing', 'Club', 400, 0, 17, 10, { mult: 1, trend: 0.6 }, true],
  ['Venom Nightclub', 'pristina', 'Dancing', 'Club', 400, 0, 11, 10, { mult: 1, trend: 0.6 }, true],
  ['LOLA', 'pristina', 'Dancing', 'Club', 400, 0, 10, 10, { mult: 1, trend: 0.6 }, true],
  ['Pablo Discobar', 'reykjavik', 'Dancing', 'Club', 400, 0, 12, 10, { mult: 1, trend: 0.6 }, true],
  ['LÚX Nightclub', 'reykjavik', 'Dancing', 'Club', 400, 0, 8, 10, { mult: 1, trend: 0.6 }, true],
  ['HAX Nightclub', 'reykjavik', 'Dancing', 'Club', 400, 0, 8, 10, { mult: 1, trend: 0.6 }, true],
  ['Fuego Openair Club', 'rhodes-old', 'Dancing', 'Club', 400, 0, 13, 18, { mult: 1, trend: 0.6 }, true],
  ['PARADISO beach club', 'rhodes-old', 'Dancing', 'Club', 400, 0, 10, 18, { mult: 1, trend: 0.6 }, true],
  ['Gazi club', 'rhodes-old', 'Dancing', 'Club', 400, 0, 11, 18, { mult: 1, trend: 0.6 }, true],
  ['POSEIDONS Club', 'riga-lv', 'Dancing', 'Club', 400, 0, 11, 10, { mult: 1, trend: 0.6 }, true],
  ['Casablanca Night Club', 'rio-lapa', 'Dancing', 'Club', 400, 0, 11, 10, { mult: 1, trend: 0.6 }, true],
  ['Ice Club Roma', 'ostiense', 'Dancing', 'Club', 400, 0, 16, 10, { mult: 1, trend: 0.6 }, true],
  ['FullMoonClub Roma', 'ostiense', 'Dancing', 'Club', 400, 0, 12, 10, { mult: 1, trend: 0.6 }, true],
  ['Eighteen Club', 'ostiense', 'Dancing', 'Club', 400, 0, 14, 10, { mult: 1, trend: 0.6 }, true],
  ['Now&Wow Club', 'rotterdam', 'Dancing', 'Club', 400, 0, 12, 10, { mult: 1, trend: 0.6 }, true],
  ['Munch', 'rotterdam', 'Dancing', 'Club', 400, 0, 17, 10, { mult: 1, trend: 0.6 }, true],
  ['Griboyedov Club', 'spb', 'Dancing', 'Club', 400, 0, 13, 10, { mult: 1, trend: 0.6 }, true],
  ['Union', 'spb', 'Dancing', 'Club', 400, 0, 17, 10, { mult: 1, trend: 0.6 }, true],
  ['Lomonosov', 'spb', 'Dancing', 'Club', 400, 0, 13, 10, { mult: 1, trend: 0.6 }, true],
  ['1902 Nightclub', 'sanantonio-dt', 'Dancing', 'Club', 400, 0, 13, 10, { mult: 1, trend: 0.6 }, true],
  ['Bonham Exchange', 'sanantonio-dt', 'Dancing', 'Club', 400, 0, 14, 10, { mult: 1, trend: 0.6 }, true],
  ['The Valencia Room', 'sf', 'Dancing', 'Club', 400, 0, 15, 10, { mult: 1, trend: 0.6 }, true],
  ['Temple Nightclub San Francisco', 'sf', 'Dancing', 'Club', 400, 0, 14, 10, { mult: 1, trend: 0.6 }, true],
  ['MOOD', 'sanjose-cr', 'Dancing', 'Club', 400, 0, 10, 10, { mult: 1, trend: 0.6 }, true],
  ['Puchos', 'sanjose-cr', 'Dancing', 'Club', 400, 0, 10, 10, { mult: 1, trend: 0.6 }, true],
  ['Nightclub Las Margaritas', 'sanjose-cr', 'Dancing', 'Club', 400, 0, 9, 10, { mult: 1, trend: 0.6 }, true],
  ['7eight7', 'sanjuan', 'Dancing', 'Club', 400, 0, 11, 10, { mult: 1, trend: 0.6 }, true],
  ['La Placita de Santurce', 'sanjuan', 'Dancing', 'Club', 400, 0, 17, 5, { mult: 1, trend: 0.6 }, true],
  ['Tulum La Placita', 'sanjuan', 'Dancing', 'Club', 400, 0, 12, 5, { mult: 1, trend: 0.6 }, true],
  ['FIRE Club Bar', 'sansalvador-zr', 'Dancing', 'Club', 400, 0, 9, 10, { mult: 1, trend: 0.6 }, true],
  ['The Rooftop', 'sansalvador-zr', 'Dancing', 'Club', 400, 0, 14, 10, { mult: 1, trend: 0.6 }, true],
  ['Pose Club Bar', 'sansalvador-zr', 'Dancing', 'Club', 400, 0, 12, 10, { mult: 1, trend: 0.6 }, true],
  ['Club Amanda', 'santiago-bel', 'Dancing', 'Club', 400, 0, 17, 10, { mult: 1, trend: 0.6 }, true],
  ['Club Ambar', 'santiago-bel', 'Dancing', 'Club', 400, 0, 17, 10, { mult: 1, trend: 0.6 }, true],
  ['Enigma Club Santorini', 'fira', 'Dancing', 'Club', 400, 0, 14, 10, { mult: 1, trend: 0.6 }, true],
  ['Le Rêve Club', 'sao-paulo', 'Dancing', 'Club', 400, 0, 14, 10, { mult: 1, trend: 0.6 }, true],
  ['CRISTAL CLUB STRIPTEASE NIGHT CLUB', 'sarajevo-centar', 'Dancing', 'Club', 400, 0, 12, 30, { mult: 1, trend: 0.6 }, true],
  ['Mash Lounge & Club', 'sarajevo-centar', 'Dancing', 'Club', 400, 0, 14, 10, { mult: 1, trend: 0.6 }, true],
  ['Frka Sarajevo', 'sarajevo-centar', 'Dancing', 'Club', 400, 0, 8, 10, { mult: 1, trend: 0.6 }, true],
  ['Lit Lounge Itaewon 릿라운지 이태원', 'seoul-itaewon', 'Dancing', 'Club', 400, 0, 12, 10, { mult: 1, trend: 0.6 }, true],
  ['KOKO', 'seville', 'Dancing', 'Club', 400, 0, 17, 10, { mult: 1, trend: 0.6 }, true],
  ['Sala Cosmos', 'seville', 'Dancing', 'Club', 400, 0, 15, 10, { mult: 1, trend: 0.6 }, true],
  ['FUN CLUB Sevilla | Sala de conciertos y discoteca', 'seville', 'Dancing', 'Club', 400, 0, 13, 10, { mult: 1, trend: 0.6 }, true],
  ['Discoteca Monasterio Sevilla', 'seville', 'Dancing', 'Club', 400, 0, 15, 10, { mult: 1, trend: 0.6 }, true],
  ['ONYX Nightclub Sheffield', 'sheffield', 'Dancing', 'Club', 400, 0, 9, 10, { mult: 1, trend: 0.6 }, true],
  ['Popworld Sheffield', 'sheffield', 'Dancing', 'Club', 400, 0, 13, 10, { mult: 1, trend: 0.6 }, true],
  ['The Viper Rooms', 'sheffield', 'Dancing', 'Club', 400, 0, 11, 10, { mult: 1, trend: 0.6 }, true],
  ['Viva Club', 'shenzhen', 'Dancing', 'Club', 400, 0, 10, 10, { mult: 1, trend: 0.6 }, true],
  ['The Terrace Bar', 'shenzhen', 'Dancing', 'Club', 400, 0, 8, 10, { mult: 1, trend: 0.6 }, true],
  ['The Brew Shenzhen', 'shenzhen', 'Bars', 'Bar', 180, 0, 8, 0, { mult: 1, trend: 0.6 }, true],
  ['Tasmac Club Singapore', 'singapore', 'Dancing', 'Club', 400, 0, 11, 10, { mult: 1, trend: 0.6 }, true],
  ['RASA Space', 'singapore', 'Dancing', 'Club', 400, 0, 12, 10, { mult: 1, trend: 0.6 }, true],
  ['Club DaVinci', 'sofia', 'Dancing', 'Club', 400, 0, 14, 30, { mult: 1, trend: 0.6 }, true],
  ['Carrusel Club', 'sofia', 'Dancing', 'Club', 400, 0, 17, 10, { mult: 1, trend: 0.6 }, true],
  ['Mewa Towarzyska', 'sopot', 'Dancing', 'Club', 400, 0, 13, 10, { mult: 1, trend: 0.6 }, true],
  ['Klub Story Disco Sopot & Shisha Lounge', 'sopot', 'Dancing', 'Club', 400, 0, 14, 10, { mult: 1, trend: 0.6 }, true],
  ['Sense Stockholm', 'stockholm', 'Dancing', 'Club', 400, 0, 12, 10, { mult: 1, trend: 0.6 }, true],
  ['X Bar Club', 'sunnybeach', 'Dancing', 'Club', 400, 0, 8, 18, { mult: 1, trend: 0.6 }, true],
  ['Gabana Nightclub, Sunny Beach', 'sunnybeach', 'Dancing', 'Club', 400, 0, 14, 30, { mult: 1, trend: 0.6 }, true],
  ['DGV - Sunny Beach', 'sunnybeach', 'Dancing', 'Club', 400, 0, 10, 18, { mult: 1, trend: 0.6 }, true],
  ['Side Bar', 'sydney', 'Dancing', 'Club', 400, 0, 18, 10, { mult: 1, trend: 0.6 }, true],
  ['3WM Night Club Sydney', 'sydney', 'Dancing', 'Club', 400, 0, 9, 10, { mult: 1, trend: 0.6 }, true],
  ['AI Club', 'taipei', 'Dancing', 'Club', 400, 0, 13, 10, { mult: 1, trend: 0.6 }, true],
  ['KOR Taipei', 'taipei', 'Dancing', 'Club', 400, 0, 17, 10, { mult: 1, trend: 0.6 }, true],
  ['Whisper Sister', 'tallinn', 'Dancing', 'Club', 400, 0, 15, 10, { mult: 1, trend: 0.6 }, true],
  ['IKIGAI', 'tallinn', 'Dancing', 'Club', 400, 0, 9, 10, { mult: 1, trend: 0.6 }, true],
  ['WOLF Night club', 'tashkent', 'Dancing', 'Club', 400, 0, 8, 18, { mult: 1, trend: 0.6 }, true],
  ['Bootlegger', 'tashkent', 'Dancing', 'Club', 400, 0, 8, 30, { mult: 1, trend: 0.6 }, true],
  ['Nochnoy Klub "Prince"', 'tashkent', 'Dancing', 'Club', 400, 0, 10, 10, { mult: 1, trend: 0.6 }, true],
  ['Safe Night Club', 'tbilisi', 'Dancing', 'Club', 400, 0, 13, 30, { mult: 1, trend: 0.6 }, true],
  ['Flava Tbilisi', 'tbilisi', 'Dancing', 'Club', 400, 0, 11, 10, { mult: 1, trend: 0.6 }, true],
  ['Vice City Tbilisi', 'tbilisi', 'Dancing', 'Club', 400, 0, 12, 10, { mult: 1, trend: 0.6 }, true],
  ['Gagarin Club TLV', 'telaviv', 'Dancing', 'Club', 400, 0, 15, 10, { mult: 1, trend: 0.6 }, true],
  ['Dream Exhibition Club', 'telaviv', 'Dancing', 'Club', 400, 0, 11, 10, { mult: 1, trend: 0.6 }, true],
  ['Lust Night Club ( Strip )', 'blloku', 'Dancing', 'Club', 400, 0, 11, 10, { mult: 1, trend: 0.6 }, true],
  ['Escape Premium Club', 'blloku', 'Dancing', 'Club', 400, 0, 10, 10, { mult: 1, trend: 0.6 }, true],
  ['Illyrian Saloon', 'blloku', 'Dancing', 'Club', 400, 0, 14, 10, { mult: 1, trend: 0.6 }, true],
  ['Frekuence Club', 'blloku', 'Dancing', 'Club', 400, 0, 9, 10, { mult: 1, trend: 0.6 }, true],
  ['Lost and Found', 'toronto', 'Dancing', 'Club', 400, 0, 13, 10, { mult: 1, trend: 0.6 }, true],
  ['Future', 'toronto', 'Dancing', 'Club', 400, 0, 12, 10, { mult: 1, trend: 0.6 }, true],
  ['Tulum Social Pubcrawl', 'tulum', 'Dancing', 'Club', 400, 0, 14, 5, { mult: 1, trend: 0.6 }, true],
  ['Batey Mojito and Guarapo Bar', 'tulum', 'Dancing', 'Club', 400, 0, 17, 5, { mult: 1, trend: 0.6 }, true],
  ['Patito Total Fun Rooftop', 'tulum', 'Dancing', 'Club', 400, 0, 12, 10, { mult: 1, trend: 0.6 }, true],
  ['Mya Club', 'valencia', 'Dancing', 'Club', 400, 0, 19, 10, { mult: 1, trend: 0.6 }, true],
  ['Marina Beach Club', 'valencia', 'Dancing', 'Club', 400, 0, 18, 10, { mult: 1, trend: 0.6 }, true],
  ['Piccadilly Downtown Club', 'valencia', 'Dancing', 'Club', 400, 0, 18, 10, { mult: 1, trend: 0.6 }, true],
  ['Club Mumbai Vancouver', 'vancouver', 'Dancing', 'Club', 400, 0, 11, 10, { mult: 1, trend: 0.6 }, true],
  ['Mansion Nightclub', 'vancouver', 'Dancing', 'Club', 400, 0, 13, 10, { mult: 1, trend: 0.6 }, true],
  ['The Red Room', 'vancouver', 'Dancing', 'Club', 400, 0, 15, 10, { mult: 1, trend: 0.6 }, true],
  ['Tamsta Club', 'vilnius', 'Dancing', 'Club', 400, 0, 16, 10, { mult: 1, trend: 0.6 }, true],
  ['Youngs\' Club', 'vilnius', 'Dancing', 'Club', 400, 0, 12, 10, { mult: 1, trend: 0.6 }, true],
  ['Burlesque Night Club', 'vilnius', 'Dancing', 'Club', 400, 0, 10, 30, { mult: 1, trend: 0.6 }, true],
  ['Ultrabar', 'dc', 'Dancing', 'Club', 400, 0, 15, 10, { mult: 1, trend: 0.6 }, true],
  ['Decades DC', 'dc', 'Dancing', 'Club', 400, 0, 17, 10, { mult: 1, trend: 0.6 }, true],
  ['ONYX Rooftop Lounge', 'dc', 'Dancing', 'Club', 400, 0, 11, 30, { mult: 1, trend: 0.6 }, true],
  ['Stop Club', 'yerevan', 'Dancing', 'Club', 400, 0, 11, 10, { mult: 1, trend: 0.6 }, true],
  ['Club 11', 'yerevan', 'Dancing', 'Club', 400, 0, 8, 10, { mult: 1, trend: 0.6 }, true],
  ['WHY NOT EVN', 'yerevan', 'Dancing', 'Club', 400, 0, 11, 10, { mult: 1, trend: 0.6 }, true],
  ['Night Club & Rock Bar Alcatraz', 'zagreb', 'Dancing', 'Club', 400, 0, 17, 10, { mult: 1, trend: 0.6 }, true],
  ['Aquarius club Zagreb', 'zagreb', 'Dancing', 'Club', 400, 0, 13, 5, { mult: 1, trend: 0.6 }, true],
  ['Boogaloo Club', 'zagreb', 'Dancing', 'Club', 400, 0, 15, 10, { mult: 1, trend: 0.6 }, true],
  ['Cebu Club', 'laganas', 'Dancing', 'Club', 400, 0, 13, 18, { mult: 1, trend: 0.6 }, true],
  ['Barrage Club', 'laganas', 'Dancing', 'Club', 400, 0, 14, 18, { mult: 1, trend: 0.6 }, true],
  ['Jade Club', 'zurich', 'Dancing', 'Club', 400, 0, 13, 10, { mult: 1, trend: 0.6 }, true],
  // --- named + top-up (Google Places) ---
  ['Mazel Tov', 'erzsebetvaros', 'Bars', 'Bar', 180, 0, 20, 0, { mult: 1, trend: 0.6 }, true],
  ['Doboz', 'erzsebetvaros', 'Dancing', 'Club', 400, 0, 18, 10, { mult: 1, trend: 0.6 }, true],
  ['Kőleves kert', 'erzsebetvaros', 'Bars', 'Bar', 180, 0, 18, 0, { mult: 1, trend: 0.6 }, true],
  ['Little Bar', 'chengdu', 'Bars', 'Bar', 180, 0, 8, 0, { mult: 1, trend: 0.6 }, true],
  ['Wuzao', 'chengdu', 'Bars', 'Bar', 180, 0, 8, 0, { mult: 1, trend: 0.6 }, true],
  // --- named + top-up (Google Places) ---
  ['Shamrock Irish Bar and Restaurant', 'chengdu', 'Bars', 'Bar', 180, 0, 9, 0, { mult: 1, trend: 0.6 }, true],
  // --- discovered from Google Places ---
  ['Nowhere', 'phangan-haadrin', 'Dancing', 'Club', 400, 0, 8, 10, { mult: 1, trend: 0.6 }, true],
  ['Unclave Phangan', 'phangan-haadrin', 'Dancing', 'Club', 400, 0, 9, 10, { mult: 1, trend: 0.6 }, true],
  ['Retro Mountain Jungle Club Phangan', 'phangan-haadrin', 'Dancing', 'Club', 400, 0, 13, 10, { mult: 1, trend: 0.6 }, true],
  ['OXA - Jungle Party', 'phangan-haadrin', 'Dancing', 'Club', 400, 0, 18, 10, { mult: 1, trend: 0.6 }, true],
  ['Waterfall Festival', 'phangan-haadrin', 'Dancing', 'Club', 400, 0, 14, 10, { mult: 1, trend: 0.6 }, true],
  ['Sound Club Samui', 'samui-chaweng', 'Dancing', 'Club', 400, 0, 15, 10, { mult: 1, trend: 0.6 }, true],
  ['The Green Mango', 'samui-chaweng', 'Dancing', 'Club', 400, 0, 17, 10, { mult: 1, trend: 0.6 }, true],
  ['Sin By Night', 'samui-chaweng', 'Dancing', 'Club', 400, 0, 10, 10, { mult: 1, trend: 0.6 }, true],
  ['Hush Bar', 'samui-chaweng', 'Dancing', 'Club', 400, 0, 13, 10, { mult: 1, trend: 0.6 }, true],
  ['Sandbox - Pink Sand Beach Club', 'samui-chaweng', 'Dancing', 'Club', 400, 0, 10, 10, { mult: 1, trend: 0.6 }, true],
  ['Queen\'s Cabaret', 'kohtao-sairee', 'Dancing', 'Club', 400, 0, 14, 10, { mult: 1, trend: 0.6 }, true],
  ['AC Bar Beach Club', 'kohtao-sairee', 'Dancing', 'Club', 400, 0, 13, 10, { mult: 1, trend: 0.6 }, true],
  ['Fishbowl Beach Bar', 'kohtao-sairee', 'Dancing', 'Club', 400, 0, 16, 10, { mult: 1, trend: 0.6 }, true],
  ['Maya Beach Club Koh Tao', 'kohtao-sairee', 'Dancing', 'Club', 400, 0, 13, 10, { mult: 1, trend: 0.6 }, true],
  ['Escobar Koh Tao', 'kohtao-sairee', 'Dancing', 'Club', 400, 0, 13, 10, { mult: 1, trend: 0.6 }, true],
  ['AfroRoom Nightclub Phuket', 'phuket-bangla', 'Dancing', 'Club', 400, 0, 10, 10, { mult: 1, trend: 0.6 }, true],
  ['Illuzion Phuket', 'phuket-bangla', 'Dancing', 'Club', 400, 0, 20, 10, { mult: 1, trend: 0.6 }, true],
  ['BOA Nightclub Phuket', 'phuket-bangla', 'Dancing', 'Club', 400, 0, 12, 10, { mult: 1, trend: 0.6 }, true],
  ['Armania Phuket', 'phuket-bangla', 'Dancing', 'Club', 400, 0, 15, 10, { mult: 1, trend: 0.6 }, true],
  ['Hollywood Phuket', 'phuket-bangla', 'Dancing', 'Club', 400, 0, 10, 10, { mult: 1, trend: 0.6 }, true],
  // --- discovered from Google Places ---
  ['Tulua Nightclub and Cocktail Bar', 'cincy-otr', 'Dancing', 'Club', 400, 0, 10, 10, { mult: 1, trend: 0.6 }, true],
  ['Cove 51', 'cincy-otr', 'Dancing', 'Club', 400, 0, 9, 10, { mult: 1, trend: 0.6 }, true],
  ['LoVe on Fourth', 'cincy-otr', 'Dancing', 'Club', 400, 0, 11, 10, { mult: 1, trend: 0.6 }, true],
  ['Alice', 'cincy-otr', 'Dancing', 'Club', 400, 0, 12, 5, { mult: 1, trend: 0.6 }, true],
  ['Flight Club Cincinnati', 'cincy-otr', 'Dancing', 'Club', 400, 0, 11, 10, { mult: 1, trend: 0.6 }, true],
  ['Forty Deuce Burlesque & Speakeasy', 'columbus-shortnorth', 'Dancing', 'Club', 400, 0, 17, 10, { mult: 1, trend: 0.6 }, true],
  ['Axis Nightclub', 'columbus-shortnorth', 'Dancing', 'Club', 400, 0, 13, 10, { mult: 1, trend: 0.6 }, true],
  ['District West', 'columbus-shortnorth', 'Dancing', 'Club', 400, 0, 11, 10, { mult: 1, trend: 0.6 }, true],
  ['The Forum', 'columbus-shortnorth', 'Dancing', 'Club', 400, 0, 11, 10, { mult: 1, trend: 0.6 }, true],
  ['Palmas Tropical Escape', 'columbus-shortnorth', 'Dancing', 'Club', 400, 0, 11, 10, { mult: 1, trend: 0.6 }, true],
  ['The Church Nightclub', 'denver-lodo', 'Dancing', 'Club', 400, 0, 16, 10, { mult: 1, trend: 0.6 }, true],
  ['Milk Bar', 'denver-lodo', 'Dancing', 'Club', 400, 0, 15, 10, { mult: 1, trend: 0.6 }, true],
  ['Mockingbird', 'denver-lodo', 'Dancing', 'Club', 400, 0, 11, 10, { mult: 1, trend: 0.6 }, true],
  ['XSO Night Club', 'denver-lodo', 'Dancing', 'Club', 400, 0, 12, 10, { mult: 1, trend: 0.6 }, true],
  ['The Black Box', 'denver-lodo', 'Dancing', 'Club', 400, 0, 16, 10, { mult: 1, trend: 0.6 }, true],
  ['The Red Room', 'indy-massave', 'Dancing', 'Club', 400, 0, 12, 5, { mult: 1, trend: 0.6 }, true],
  ['Estereo Nightclub', 'indy-massave', 'Dancing', 'Club', 400, 0, 12, 10, { mult: 1, trend: 0.6 }, true],
  ['PT\'s Showclub Indianapolis', 'indy-massave', 'Dancing', 'Club', 400, 0, 13, 10, { mult: 1, trend: 0.6 }, true],
  ['Paradox Lounge', 'indy-massave', 'Dancing', 'Club', 400, 0, 11, 10, { mult: 1, trend: 0.6 }, true],
  ['Georgia Street | Rhythm and Blues', 'indy-massave', 'Dancing', 'Club', 400, 0, 12, 10, { mult: 1, trend: 0.6 }, true],
  ['Club Casablanca', 'kc-downtown', 'Dancing', 'Club', 400, 0, 8, 10, { mult: 1, trend: 0.6 }, true],
  ['Aura', 'kc-downtown', 'Dancing', 'Club', 400, 0, 15, 10, { mult: 1, trend: 0.6 }, true],
  ['BLVD Nights', 'kc-downtown', 'Dancing', 'Club', 400, 0, 11, 10, { mult: 1, trend: 0.6 }, true],
  ['Mosaic', 'kc-downtown', 'Dancing', 'Club', 400, 0, 13, 10, { mult: 1, trend: 0.6 }, true],
  ['Lotus', 'kc-downtown', 'Dancing', 'Club', 400, 0, 14, 10, { mult: 1, trend: 0.6 }, true],
  ['Slinky Bar', 'phiphi-tonsai', 'Dancing', 'Club', 400, 0, 17, 10, { mult: 1, trend: 0.6 }, true],
  ['Sunflower Beach Bar', 'phiphi-tonsai', 'Dancing', 'Club', 400, 0, 13, 10, { mult: 1, trend: 0.6 }, true],
  ['Reggae Bar', 'phiphi-tonsai', 'Dancing', 'Club', 400, 0, 16, 5, { mult: 1, trend: 0.6 }, true],
  ['Carlito\'s bar', 'phiphi-tonsai', 'Dancing', 'Club', 400, 0, 15, 10, { mult: 1, trend: 0.6 }, true],
  ['Scubar The Third Chapter', 'phiphi-tonsai', 'Dancing', 'Club', 400, 0, 13, 10, { mult: 1, trend: 0.6 }, true],
  ['Boogie Bar', 'krabi-aonang', 'Dancing', 'Club', 400, 0, 16, 10, { mult: 1, trend: 0.6 }, true],
  ['CENTRE POINT', 'krabi-aonang', 'Dancing', 'Club', 400, 0, 8, 10, { mult: 1, trend: 0.6 }, true],
  ['Ao Nang Pub Crawl', 'krabi-aonang', 'Dancing', 'Club', 400, 0, 8, 10, { mult: 1, trend: 0.6 }, true],
  ['Tribe Beach Bar', 'krabi-aonang', 'Dancing', 'Club', 400, 0, 13, 10, { mult: 1, trend: 0.6 }, true],
  ['Kiss Bar Ao Nang', 'krabi-aonang', 'Dancing', 'Club', 400, 0, 11, 10, { mult: 1, trend: 0.6 }, true],
  ['Paula & Raiford\'s Disco', 'memphis-beale', 'Dancing', 'Club', 400, 0, 11, 10, { mult: 1, trend: 0.6 }, true],
  ['In Love Memphis', 'memphis-beale', 'Dancing', 'Club', 400, 0, 16, 18, { mult: 1, trend: 0.6 }, true],
  ['Club 152', 'memphis-beale', 'Dancing', 'Club', 400, 0, 11, 10, { mult: 1, trend: 0.6 }, true],
  ['Club la rumba', 'memphis-beale', 'Dancing', 'Club', 400, 0, 11, 5, { mult: 1, trend: 0.6 }, true],
  ['B.B. King\'s Blues Club', 'memphis-beale', 'Dancing', 'Club', 400, 0, 20, 10, { mult: 1, trend: 0.6 }, true],
  ['Bodega', 'milwaukee-thirdward', 'Dancing', 'Club', 400, 0, 11, 10, { mult: 1, trend: 0.6 }, true],
  ['Club Timbuktu', 'milwaukee-thirdward', 'Dancing', 'Club', 400, 0, 9, 5, { mult: 1, trend: 0.6 }, true],
  ['MADPLANET', 'milwaukee-thirdward', 'Dancing', 'Club', 400, 0, 12, 5, { mult: 1, trend: 0.6 }, true],
  ['LaCage NiteClub', 'milwaukee-thirdward', 'Dancing', 'Club', 400, 0, 12, 10, { mult: 1, trend: 0.6 }, true],
  ['No. 720', 'milwaukee-thirdward', 'Dancing', 'Club', 400, 0, 11, 10, { mult: 1, trend: 0.6 }, true],
  ['REV Ultra Lounge', 'mpls-downtown', 'Dancing', 'Club', 400, 0, 9, 10, { mult: 1, trend: 0.6 }, true],
  ['Ground Zero Nightclub', 'mpls-downtown', 'Dancing', 'Club', 400, 0, 13, 5, { mult: 1, trend: 0.6 }, true],
  ['Vanquish Nightclub', 'mpls-downtown', 'Dancing', 'Club', 400, 0, 10, 10, { mult: 1, trend: 0.6 }, true],
  ['The Saloon', 'mpls-downtown', 'Dancing', 'Club', 400, 0, 14, 10, { mult: 1, trend: 0.6 }, true],
  ['331 Club', 'mpls-downtown', 'Dancing', 'Club', 400, 0, 13, 5, { mult: 1, trend: 0.6 }, true],
  ['Broadway', 'nashville-broadway', 'Dancing', 'Club', 400, 0, 12, 10, { mult: 1, trend: 0.6 }, true],
  ['Dirty Little Secret', 'nashville-broadway', 'Dancing', 'Club', 400, 0, 12, 10, { mult: 1, trend: 0.6 }, true],
  ['Night We Met', 'nashville-broadway', 'Dancing', 'Club', 400, 0, 11, 10, { mult: 1, trend: 0.6 }, true],
  ['Club Premium Nashville TN', 'nashville-broadway', 'Dancing', 'Club', 400, 0, 9, 5, { mult: 1, trend: 0.6 }, true],
  ['Friends in Low Places Bar & Honky-Tonk', 'nashville-broadway', 'Dancing', 'Club', 400, 0, 19, 5, { mult: 1, trend: 0.6 }, true],
  ['One15 Nightclub', 'okc-bricktown', 'Dancing', 'Club', 400, 0, 14, 10, { mult: 1, trend: 0.6 }, true],
  ['Las Locas Nightclub', 'okc-bricktown', 'Dancing', 'Club', 400, 0, 11, 10, { mult: 1, trend: 0.6 }, true],
  ['Secrets', 'okc-bricktown', 'Dancing', 'Club', 400, 0, 11, 10, { mult: 1, trend: 0.6 }, true],
  ['Night Trips', 'okc-bricktown', 'Dancing', 'Club', 400, 0, 14, 10, { mult: 1, trend: 0.6 }, true],
  ['Santos Nightlife', 'okc-bricktown', 'Dancing', 'Club', 400, 0, 8, 10, { mult: 1, trend: 0.6 }, true],
  ['Xantolo Night Club', 'phoenix-scottsdale', 'Dancing', 'Club', 400, 0, 12, 10, { mult: 1, trend: 0.6 }, true],
  ['Dwntwn', 'phoenix-scottsdale', 'Dancing', 'Club', 400, 0, 14, 10, { mult: 1, trend: 0.6 }, true],
  ['Karamba Nightclub', 'phoenix-scottsdale', 'Dancing', 'Club', 400, 0, 13, 10, { mult: 1, trend: 0.6 }, true],
  ['CasaMoreno Nightclub - Phoenix, Arizona', 'phoenix-scottsdale', 'Dancing', 'Club', 400, 0, 10, 10, { mult: 1, trend: 0.6 }, true],
  ['Cake Nightclub', 'phoenix-scottsdale', 'Dancing', 'Club', 400, 0, 11, 30, { mult: 1, trend: 0.6 }, true],
  ['IBIZA SLC Ultra lounge', 'slc-downtown', 'Dancing', 'Club', 400, 0, 13, 10, { mult: 1, trend: 0.6 }, true],
  ['Lake Effect', 'slc-downtown', 'Dancing', 'Club', 400, 0, 17, 10, { mult: 1, trend: 0.6 }, true],
  ['Sky SLC', 'slc-downtown', 'Dancing', 'Club', 400, 0, 14, 10, { mult: 1, trend: 0.6 }, true],
  ['Area 51', 'slc-downtown', 'Dancing', 'Club', 400, 0, 15, 5, { mult: 1, trend: 0.6 }, true],
  ['Molly\'s Gemini Room', 'slc-downtown', 'Dancing', 'Club', 400, 0, 10, 30, { mult: 1, trend: 0.6 }, true],
  ['Europe Night Club', 'stl-grove', 'Dancing', 'Club', 400, 0, 12, 5, { mult: 1, trend: 0.6 }, true],
  ['Just John Club 🏳️‍🌈', 'stl-grove', 'Dancing', 'Club', 400, 0, 12, 5, { mult: 1, trend: 0.6 }, true],
  ['Oz Nightclub', 'stl-grove', 'Dancing', 'Club', 400, 0, 12, 10, { mult: 1, trend: 0.6 }, true],
  ['Tin Roof', 'stl-grove', 'Dancing', 'Club', 400, 0, 16, 5, { mult: 1, trend: 0.6 }, true],
  ['RYSE Nightclub', 'stl-grove', 'Dancing', 'Club', 400, 0, 11, 10, { mult: 1, trend: 0.6 }, true],
  // --- discovered per-hood ---
  ['Barney\'s Beanery', 'la-westwood', 'Bars', 'Bar', 180, 0, 15, 10, { mult: 1, trend: 0.6 }, true],
  ['Rocco\'s Tavern -Westwood', 'la-westwood', 'Bars', 'Bar', 180, 0, 14, 10, { mult: 1, trend: 0.6 }, true],
  ['The Tuck Room', 'la-westwood', 'Bars', 'Bar', 180, 0, 12, 10, { mult: 1, trend: 0.6 }, true],
  ['House of Meatballs', 'la-westwood', 'Bars', 'Bar', 180, 0, 14, 10, { mult: 1, trend: 0.6 }, true],
  ['901 Bar and Grill', 'la-usc', 'Bars', 'Bar', 180, 0, 14, 10, { mult: 1, trend: 0.6 }, true],
  ['The Lab Gastropub', 'la-usc', 'Bars', 'Bar', 180, 0, 14, 0, { mult: 1, trend: 0.6 }, true],
  ['33 Taps DTLA', 'la-usc', 'Bars', 'Bar', 180, 0, 13, 10, { mult: 1, trend: 0.6 }, true],
  ['Mal\'s Bar', 'la-usc', 'Bars', 'Bar', 180, 0, 13, 5, { mult: 1, trend: 0.6 }, true],
  ['Exchange LA', 'la-downtown', 'Dancing', 'Club', 400, 0, 15, 10, { mult: 1, trend: 0.6 }, true],
  ['Elevate Lounge', 'la-downtown', 'Dancing', 'Club', 400, 0, 14, 10, { mult: 1, trend: 0.6 }, true],
  ['West Eight Los Angeles', 'la-downtown', 'Dancing', 'Club', 400, 0, 8, 10, { mult: 1, trend: 0.6 }, true],
  ['The Reserve', 'la-downtown', 'Dancing', 'Club', 400, 0, 13, 10, { mult: 1, trend: 0.6 }, true],
  ['The Silverlake Lounge', 'la-silverlake', 'Dancing', 'Club', 400, 0, 12, 10, { mult: 1, trend: 0.6 }, true],
  ['Los Globos', 'la-silverlake', 'Dancing', 'Club', 400, 0, 14, 10, { mult: 1, trend: 0.6 }, true],
  ['Cha Cha Lounge', 'la-silverlake', 'Dancing', 'Club', 400, 0, 13, 5, { mult: 1, trend: 0.6 }, true],
  ['Panamerican Night Club', 'la-silverlake', 'Dancing', 'Club', 400, 0, 11, 10, { mult: 1, trend: 0.6 }, true],
  // --- discovered from Google Places ---
  ['Alizée Club', 'abidjan', 'Dancing', 'Club', 400, 0, 12, 10, { mult: 1, trend: 0.6 }, true],
  ['Le Saint Germain Club Abidjan', 'abidjan', 'Dancing', 'Club', 400, 0, 14, 10, { mult: 1, trend: 0.6 }, true],
  ['Rex Night Club', 'abidjan', 'Dancing', 'Club', 400, 0, 10, 10, { mult: 1, trend: 0.6 }, true],
  ['Notorious', 'abidjan', 'Dancing', 'Club', 400, 0, 10, 10, { mult: 1, trend: 0.6 }, true],
  ['Life Star', 'abidjan', 'Dancing', 'Club', 400, 0, 13, 10, { mult: 1, trend: 0.6 }, true],
  ['Las Vibras de la Casbah', 'antigua-gt', 'Dancing', 'Club', 400, 0, 13, 10, { mult: 1, trend: 0.6 }, true],
  ['La Sala', 'antigua-gt', 'Dancing', 'Club', 400, 0, 15, 10, { mult: 1, trend: 0.6 }, true],
  ['Reilly\'s Antigua', 'antigua-gt', 'Dancing', 'Club', 400, 0, 16, 10, { mult: 1, trend: 0.6 }, true],
  ['Vudu bar', 'antigua-gt', 'Dancing', 'Club', 400, 0, 11, 10, { mult: 1, trend: 0.6 }, true],
  ['Ulew Cocktail Bar', 'antigua-gt', 'Dancing', 'Club', 400, 0, 14, 10, { mult: 1, trend: 0.6 }, true],
  ['The Verse Allure', 'belizecity', 'Dancing', 'Club', 400, 0, 8, 10, { mult: 1, trend: 0.6 }, true],
  ['Thirsty Thursday', 'belizecity', 'Dancing', 'Club', 400, 0, 10, 10, { mult: 1, trend: 0.6 }, true],
  ['building', 'belizecity', 'Dancing', 'Club', 400, 0, 8, 10, { mult: 1, trend: 0.6 }, true],
  ['Bar', 'belizecity', 'Dancing', 'Club', 400, 0, 9, 10, { mult: 1, trend: 0.6 }, true],
  ['Cork Street Whiskey Bar', 'belizecity', 'Bars', 'Bar', 180, 0, 9, 0, { mult: 1, trend: 0.6 }, true],
  ['Barco Hundido', 'bocas', 'Dancing', 'Club', 400, 0, 15, 10, { mult: 1, trend: 0.6 }, true],
  ['Space Lounge & Club', 'bocas', 'Dancing', 'Club', 400, 0, 11, 10, { mult: 1, trend: 0.6 }, true],
  ['Bom Bom Beach Bar at Island Plantation', 'bocas', 'Dancing', 'Club', 400, 0, 12, 10, { mult: 1, trend: 0.6 }, true],
  ['La Coralina Beach Club', 'bocas', 'Dancing', 'Club', 400, 0, 8, 10, { mult: 1, trend: 0.6 }, true],
  ['•Boya de Vida• Floating Bar', 'bocas', 'Dancing', 'Club', 400, 0, 12, 10, { mult: 1, trend: 0.6 }, true],
  ['La Pérgola Clandestina', 'cali', 'Dancing', 'Club', 400, 0, 19, 10, { mult: 1, trend: 0.6 }, true],
  ['Pasarela Night Club', 'cali', 'Dancing', 'Club', 400, 0, 10, 10, { mult: 1, trend: 0.6 }, true],
  ['ELIPTICA CLUB', 'cali', 'Dancing', 'Club', 400, 0, 9, 10, { mult: 1, trend: 0.6 }, true],
  ['Living Night Club', 'cali', 'Dancing', 'Club', 400, 0, 18, 10, { mult: 1, trend: 0.6 }, true],
  ['Euphoria Sky Cali', 'cali', 'Dancing', 'Club', 400, 0, 8, 10, { mult: 1, trend: 0.6 }, true],
  ['Amnesia Disco & Pool', 'caracas', 'Dancing', 'Club', 400, 0, 14, 10, { mult: 1, trend: 0.6 }, true],
  ['Twelve Caracas', 'caracas', 'Dancing', 'Club', 400, 0, 10, 10, { mult: 1, trend: 0.6 }, true],
  ['ECO Nightclub', 'caracas', 'Dancing', 'Club', 400, 0, 11, 30, { mult: 1, trend: 0.6 }, true],
  ['Juan Sebastian Bar', 'caracas', 'Dancing', 'Club', 400, 0, 15, 10, { mult: 1, trend: 0.6 }, true],
  ['Maroma Bar', 'caracas', 'Dancing', 'Club', 400, 0, 9, 10, { mult: 1, trend: 0.6 }, true],
  ['ANIMAL Low cost', 'cordoba', 'Dancing', 'Club', 400, 0, 8, 10, { mult: 1, trend: 0.6 }, true],
  ['KBAR CLUB', 'cordoba', 'Dancing', 'Club', 400, 0, 11, 10, { mult: 1, trend: 0.6 }, true],
  ['VLΛCK', 'cordoba', 'Dancing', 'Club', 400, 0, 13, 10, { mult: 1, trend: 0.6 }, true],
  ['BAO bar/disco', 'cordoba', 'Dancing', 'Club', 400, 0, 9, 10, { mult: 1, trend: 0.6 }, true],
  ['Casa Babylon', 'cordoba', 'Dancing', 'Club', 400, 0, 16, 10, { mult: 1, trend: 0.6 }, true],
  ['Chango Club Cusco', 'cusco', 'Dancing', 'Club', 400, 0, 14, 10, { mult: 1, trend: 0.6 }, true],
  ['Te Macho Vip', 'cusco', 'Dancing', 'Club', 400, 0, 11, 10, { mult: 1, trend: 0.6 }, true],
  ['El Muki', 'cusco', 'Dancing', 'Club', 400, 0, 14, 10, { mult: 1, trend: 0.6 }, true],
  ['Inka Team', 'cusco', 'Dancing', 'Club', 400, 0, 14, 10, { mult: 1, trend: 0.6 }, true],
  ['La chupiteria the shot bar', 'cusco', 'Dancing', 'Club', 400, 0, 17, 10, { mult: 1, trend: 0.6 }, true],
  ['UNCLE\'S LOUNGE', 'dar', 'Dancing', 'Club', 400, 0, 13, 30, { mult: 1, trend: 0.6 }, true],
  ['BLOCKHOUSE Bar and Night Club', 'dar', 'Dancing', 'Club', 400, 0, 13, 10, { mult: 1, trend: 0.6 }, true],
  ['Club Next Door', 'dar', 'Dancing', 'Club', 400, 0, 10, 10, { mult: 1, trend: 0.6 }, true],
  ['1245 Lounge, Bar and Restaurant', 'dar', 'Dancing', 'Club', 400, 0, 13, 30, { mult: 1, trend: 0.6 }, true],
  ['Grand Nolasco Night Club', 'dar', 'Dancing', 'Club', 400, 0, 12, 10, { mult: 1, trend: 0.6 }, true],
  ['Santa Club Lagoa Nightclub', 'floripa', 'Dancing', 'Club', 400, 0, 16, 10, { mult: 1, trend: 0.6 }, true],
  ['Don\'t Tell Mama', 'floripa', 'Dancing', 'Club', 400, 0, 14, 10, { mult: 1, trend: 0.6 }, true],
  ['The Roof', 'floripa', 'Dancing', 'Club', 400, 0, 11, 30, { mult: 1, trend: 0.6 }, true],
  ['Sweet Poison Club', 'floripa', 'Dancing', 'Club', 400, 0, 11, 30, { mult: 1, trend: 0.6 }, true],
  ['Mansão 147 Premium - Boate Florianópolis', 'floripa', 'Dancing', 'Club', 400, 0, 12, 30, { mult: 1, trend: 0.6 }, true],
  ['The Salome Night Club', 'guayaquil', 'Dancing', 'Club', 400, 0, 9, 18, { mult: 1, trend: 0.6 }, true],
  ['La Mansión Night Club Guayaquil', 'guayaquil', 'Dancing', 'Club', 400, 0, 11, 10, { mult: 1, trend: 0.6 }, true],
  ['NIGHT CLUB OBSESION 5 ESTRELLAS', 'guayaquil', 'Dancing', 'Club', 400, 0, 11, 10, { mult: 1, trend: 0.6 }, true],
  ['Odisea Romana NIGHT CLUB Guayaquil', 'guayaquil', 'Dancing', 'Club', 400, 0, 8, 10, { mult: 1, trend: 0.6 }, true],
  ['Night Club Black Bull', 'guayaquil', 'Dancing', 'Club', 400, 0, 9, 10, { mult: 1, trend: 0.6 }, true],
  ['Evitro Lounge, Bar and Club', 'harare', 'Dancing', 'Club', 400, 0, 14, 10, { mult: 1, trend: 0.6 }, true],
  ['Habhana Lounge', 'harare', 'Dancing', 'Club', 400, 0, 10, 10, { mult: 1, trend: 0.6 }, true],
  ['Karma Lifestyle Restro-Club', 'harare', 'Dancing', 'Club', 400, 0, 11, 30, { mult: 1, trend: 0.6 }, true],
  ['Club Zone Zimbabwe', 'harare', 'Dancing', 'Club', 400, 0, 11, 10, { mult: 1, trend: 0.6 }, true],
  ['WOOD Sensations Club & Craft Beer House', 'harare', 'Dancing', 'Club', 400, 0, 13, 10, { mult: 1, trend: 0.6 }, true],
  ['Illusion', 'kampala', 'Dancing', 'Club', 400, 0, 12, 10, { mult: 1, trend: 0.6 }, true],
  ['Club Guvnor', 'kampala', 'Dancing', 'Club', 400, 0, 16, 10, { mult: 1, trend: 0.6 }, true],
  ['Club Ambiance Kampala', 'kampala', 'Dancing', 'Club', 400, 0, 11, 10, { mult: 1, trend: 0.6 }, true],
  ['vault UG', 'kampala', 'Dancing', 'Club', 400, 0, 11, 10, { mult: 1, trend: 0.6 }, true],
  ['Supremacy Lounge', 'kampala', 'Dancing', 'Club', 400, 0, 13, 10, { mult: 1, trend: 0.6 }, true],
  ['Cadillac Night Club', 'kigali', 'Dancing', 'Club', 400, 0, 10, 10, { mult: 1, trend: 0.6 }, true],
  ['Envy', 'kigali', 'Dancing', 'Club', 400, 0, 9, 10, { mult: 1, trend: 0.6 }, true],
  ['La Noche', 'kigali', 'Dancing', 'Club', 400, 0, 10, 10, { mult: 1, trend: 0.6 }, true],
  ['Gilt Club', 'kigali', 'Dancing', 'Club', 400, 0, 8, 10, { mult: 1, trend: 0.6 }, true],
  ['People Bar & Dance Venue', 'kigali', 'Dancing', 'Club', 400, 0, 10, 18, { mult: 1, trend: 0.6 }, true],
  ['Pub & Disco Malegria', 'lapaz', 'Dancing', 'Club', 400, 0, 16, 10, { mult: 1, trend: 0.6 }, true],
  ['OPEN MIND CLUB', 'lapaz', 'Dancing', 'Club', 400, 0, 13, 10, { mult: 1, trend: 0.6 }, true],
  ['Gold Classics', 'lapaz', 'Dancing', 'Club', 400, 0, 14, 10, { mult: 1, trend: 0.6 }, true],
  ['FORUM', 'lapaz', 'Dancing', 'Club', 400, 0, 14, 10, { mult: 1, trend: 0.6 }, true],
  ['Centric Club', 'lapaz', 'Dancing', 'Club', 400, 0, 14, 10, { mult: 1, trend: 0.6 }, true],
  ['23 Bar', 'leon-ni', 'Dancing', 'Club', 400, 0, 14, 10, { mult: 1, trend: 0.6 }, true],
  ['Bohemios Bar & Disco', 'leon-ni', 'Dancing', 'Club', 400, 0, 11, 10, { mult: 1, trend: 0.6 }, true],
  ['Mijunas Bar', 'leon-ni', 'Dancing', 'Club', 400, 0, 13, 5, { mult: 1, trend: 0.6 }, true],
  ['Gecko\'s Bar', 'leon-ni', 'Dancing', 'Club', 400, 0, 15, 10, { mult: 1, trend: 0.6 }, true],
  ['Bar bohemio', 'leon-ni', 'Dancing', 'Club', 400, 0, 8, 10, { mult: 1, trend: 0.6 }, true],
  ['Caminito Night Club', 'luanda', 'Dancing', 'Club', 400, 0, 8, 10, { mult: 1, trend: 0.6 }, true],
  ['Luxxe Luanda', 'luanda', 'Dancing', 'Club', 400, 0, 10, 10, { mult: 1, trend: 0.6 }, true],
  ['The Déjàvu Club Luanda', 'luanda', 'Dancing', 'Club', 400, 0, 8, 10, { mult: 1, trend: 0.6 }, true],
  ['Harmazem', 'luanda', 'Dancing', 'Club', 400, 0, 8, 30, { mult: 1, trend: 0.6 }, true],
  ['Restaurante Switch', 'luanda', 'Dancing', 'Club', 400, 0, 9, 10, { mult: 1, trend: 0.6 }, true],
  ['Ron Kon Rolas', 'managua', 'Dancing', 'Club', 400, 0, 15, 10, { mult: 1, trend: 0.6 }, true],
  ['La 42 Managua', 'managua', 'Dancing', 'Club', 400, 0, 8, 10, { mult: 1, trend: 0.6 }, true],
  ['Lounge BB Club', 'managua', 'Dancing', 'Club', 400, 0, 13, 10, { mult: 1, trend: 0.6 }, true],
  ['Plaza Zona Vip', 'managua', 'Dancing', 'Club', 400, 0, 9, 10, { mult: 1, trend: 0.6 }, true],
  ['Embassy Bar And Lounge', 'managua', 'Dancing', 'Club', 400, 0, 14, 10, { mult: 1, trend: 0.6 }, true],
  ['Matchedje Club', 'maputo', 'Dancing', 'Club', 400, 0, 11, 30, { mult: 1, trend: 0.6 }, true],
  ['Gil-Vicente Café-Bar', 'maputo', 'Dancing', 'Club', 400, 0, 11, 10, { mult: 1, trend: 0.6 }, true],
  ['Xima Bar', 'maputo', 'Dancing', 'Club', 400, 0, 16, 10, { mult: 1, trend: 0.6 }, true],
  ['Gypsy\'s Bar', 'maputo', 'Dancing', 'Club', 400, 0, 11, 10, { mult: 1, trend: 0.6 }, true],
  ['Bom de Mais Rooftop', 'maputo', 'Dancing', 'Club', 400, 0, 11, 18, { mult: 1, trend: 0.6 }, true],
  ['Club Hypnotica', 'mombasa', 'Dancing', 'Club', 400, 0, 13, 30, { mult: 1, trend: 0.6 }, true],
  ['Club Mio\'s', 'mombasa', 'Dancing', 'Club', 400, 0, 12, 10, { mult: 1, trend: 0.6 }, true],
  ['CASABLANCA CLUB', 'mombasa', 'Dancing', 'Club', 400, 0, 13, 10, { mult: 1, trend: 0.6 }, true],
  ['1922 Club', 'mombasa', 'Dancing', 'Club', 400, 0, 13, 10, { mult: 1, trend: 0.6 }, true],
  ['Al Capone Lounge Nyali', 'mombasa', 'Dancing', 'Club', 400, 0, 12, 30, { mult: 1, trend: 0.6 }, true],
  ['Clandestino RoofTop', 'playadelcarmen', 'Dancing', 'Club', 400, 0, 19, 10, { mult: 1, trend: 0.6 }, true],
  ['Coco Bongo', 'playadelcarmen', 'Dancing', 'Club', 400, 0, 19, 30, { mult: 1, trend: 0.6 }, true],
  ['Mandala Playa del Carmen', 'playadelcarmen', 'Dancing', 'Club', 400, 0, 16, 30, { mult: 1, trend: 0.6 }, true],
  ['La Vaquita Playa Del Carmen', 'playadelcarmen', 'Dancing', 'Club', 400, 0, 17, 10, { mult: 1, trend: 0.6 }, true],
  ['Social PubCrawl Playa del Carmen', 'playadelcarmen', 'Dancing', 'Club', 400, 0, 11, 5, { mult: 1, trend: 0.6 }, true],
  ['Club 155', 'quito', 'Dancing', 'Club', 400, 0, 13, 10, { mult: 1, trend: 0.6 }, true],
  ['Las vegas Night Club', 'quito', 'Dancing', 'Club', 400, 0, 8, 18, { mult: 1, trend: 0.6 }, true],
  ['The Jungle by Old Times', 'quito', 'Dancing', 'Club', 400, 0, 13, 10, { mult: 1, trend: 0.6 }, true],
  ['International Club 122', 'quito', 'Dancing', 'Club', 400, 0, 10, 18, { mult: 1, trend: 0.6 }, true],
  ['TEMPLO SOCIAL CLUB', 'quito', 'Dancing', 'Club', 400, 0, 11, 10, { mult: 1, trend: 0.6 }, true],
  ['Booty Bar', 'roatan', 'Dancing', 'Club', 400, 0, 15, 10, { mult: 1, trend: 0.6 }, true],
  ['Franks Beach Bar', 'roatan', 'Dancing', 'Club', 400, 0, 11, 30, { mult: 1, trend: 0.6 }, true],
  ['Blue Marlin', 'roatan', 'Dancing', 'Club', 400, 0, 11, 10, { mult: 1, trend: 0.6 }, true],
  ['Beachers Bar & Grill Roatan', 'roatan', 'Dancing', 'Club', 400, 0, 13, 10, { mult: 1, trend: 0.6 }, true],
  ['Kismet Beach Bar', 'roatan', 'Dancing', 'Club', 400, 0, 9, 10, { mult: 1, trend: 0.6 }, true],
  ['Platinum Lounge and Bar | savior', 'salvador', 'Dancing', 'Club', 400, 0, 11, 30, { mult: 1, trend: 0.6 }, true],
  ['Amsterdam Pop Club', 'salvador', 'Dancing', 'Club', 400, 0, 16, 18, { mult: 1, trend: 0.6 }, true],
  ['Zen Salvador', 'salvador', 'Dancing', 'Club', 400, 0, 11, 10, { mult: 1, trend: 0.6 }, true],
  ['SAN', 'salvador', 'Dancing', 'Club', 400, 0, 13, 10, { mult: 1, trend: 0.6 }, true],
  ['The Green House Music - Bar de Metal 🤘', 'salvador', 'Dancing', 'Club', 400, 0, 10, 10, { mult: 1, trend: 0.6 }, true],
  ['Le Queen', 'sanpedrosula', 'Dancing', 'Club', 400, 0, 11, 10, { mult: 1, trend: 0.6 }, true],
  ['Medusa Bar Club', 'sanpedrosula', 'Dancing', 'Club', 400, 0, 8, 10, { mult: 1, trend: 0.6 }, true],
  ['LaFugaDisco', 'sanpedrosula', 'Dancing', 'Club', 400, 0, 8, 30, { mult: 1, trend: 0.6 }, true],
  ['Caribe Disco', 'sanpedrosula', 'Dancing', 'Club', 400, 0, 8, 10, { mult: 1, trend: 0.6 }, true],
  ['Cantinala7', 'sanpedrosula', 'Bars', 'Bar', 180, 0, 9, 18, { mult: 1, trend: 0.6 }, true],
  ['BSMNT The Club', 'tunis', 'Dancing', 'Club', 400, 0, 10, 10, { mult: 1, trend: 0.6 }, true],
  ['Le Carpe Diem - Tunis', 'tunis', 'Dancing', 'Club', 400, 0, 14, 10, { mult: 1, trend: 0.6 }, true],
  ['Wax Bar', 'tunis', 'Dancing', 'Club', 400, 0, 12, 30, { mult: 1, trend: 0.6 }, true],
  ['Billionaire', 'tunis', 'Dancing', 'Club', 400, 0, 15, 30, { mult: 1, trend: 0.6 }, true],
  ['Bellini City Bar Lounge', 'tunis', 'Dancing', 'Club', 400, 0, 11, 10, { mult: 1, trend: 0.6 }, true],
  ['La Crème le club', 'valparaiso', 'Dancing', 'Club', 400, 0, 8, 10, { mult: 1, trend: 0.6 }, true],
  ['Terraza Bellavista', 'valparaiso', 'Dancing', 'Club', 400, 0, 13, 10, { mult: 1, trend: 0.6 }, true],
  ['club segundo piso', 'valparaiso', 'Dancing', 'Club', 400, 0, 9, 10, { mult: 1, trend: 0.6 }, true],
  ['Club La Sala', 'valparaiso', 'Dancing', 'Club', 400, 0, 8, 10, { mult: 1, trend: 0.6 }, true],
  ['Woo Club', 'valparaiso', 'Dancing', 'Club', 400, 0, 11, 10, { mult: 1, trend: 0.6 }, true],
  ['5K Arena', 'zanzibar', 'Dancing', 'Club', 400, 0, 10, 10, { mult: 1, trend: 0.6 }, true],
  ['Bot club Zanzibar', 'zanzibar', 'Dancing', 'Club', 400, 0, 11, 10, { mult: 1, trend: 0.6 }, true],
  ['Why Not Club Jambo Zanzibar', 'zanzibar', 'Dancing', 'Club', 400, 0, 8, 10, { mult: 1, trend: 0.6 }, true],
  ['Vip Mess Zanzibar', 'zanzibar', 'Dancing', 'Club', 400, 0, 9, 10, { mult: 1, trend: 0.6 }, true],
  ['CHE Rock Bar & Restaurant', 'zanzibar', 'Dancing', 'Club', 400, 0, 11, 10, { mult: 1, trend: 0.6 }, true],
  // --- discovered per-hood ---
  ['Sunset at EDITION', 'la-weho', 'Dancing', 'Club', 400, 0, 9, 18, { mult: 1, trend: 0.6 }, true],
  ['Zouk Los Angeles', 'la-weho', 'Dancing', 'Club', 400, 0, 8, 30, { mult: 1, trend: 0.6 }, true],
  ['Keys', 'la-weho', 'Dancing', 'Club', 400, 0, 9, 30, { mult: 1, trend: 0.6 }, true],
  ['1 OAK', 'la-weho', 'Dancing', 'Club', 400, 0, 11, 10, { mult: 1, trend: 0.6 }, true],
  ['Kiss Kiss Bang Bang', 'la-ktown', 'Dancing', 'Club', 400, 0, 11, 10, { mult: 1, trend: 0.6 }, true],
  ['Apt 503 Lounge', 'la-ktown', 'Dancing', 'Club', 400, 0, 13, 5, { mult: 1, trend: 0.6 }, true],
  ['Fountain LA', 'la-ktown', 'Dancing', 'Club', 400, 0, 10, 10, { mult: 1, trend: 0.6 }, true],
  ['The Normandie Club', 'la-ktown', 'Dancing', 'Club', 400, 0, 14, 10, { mult: 1, trend: 0.6 }, true],
  ['The Room Santa Monica', 'la-santamonica', 'Dancing', 'Club', 400, 0, 12, 10, { mult: 1, trend: 0.6 }, true],
  ['Harvelle\'s', 'la-santamonica', 'Dancing', 'Club', 400, 0, 14, 10, { mult: 1, trend: 0.6 }, true],
  ['Circle Bar', 'la-santamonica', 'Dancing', 'Club', 400, 0, 13, 5, { mult: 1, trend: 0.6 }, true],
  ['The Bungalow Santa Monica', 'la-santamonica', 'Dancing', 'Club', 400, 0, 16, 10, { mult: 1, trend: 0.6 }, true],
  ['Venice Beach Club', 'la-venice', 'Dancing', 'Club', 400, 0, 11, 10, { mult: 1, trend: 0.6 }, true],
  ['The Lincoln', 'la-venice', 'Dancing', 'Club', 400, 0, 13, 10, { mult: 1, trend: 0.6 }, true],
  ['The Del Monte Speakeasy', 'la-venice', 'Dancing', 'Club', 400, 0, 11, 10, { mult: 1, trend: 0.6 }, true],
  ['The Venice West', 'la-venice', 'Dancing', 'Club', 400, 0, 13, 10, { mult: 1, trend: 0.6 }, true],
  ['The Echo', 'la-echopark', 'Dancing', 'Club', 400, 0, 15, 10, { mult: 1, trend: 0.6 }, true],
  ['Club Bahia', 'la-echopark', 'Dancing', 'Club', 400, 0, 13, 10, { mult: 1, trend: 0.6 }, true],
  ['Little Joy Cocktails', 'la-echopark', 'Dancing', 'Club', 400, 0, 13, 10, { mult: 1, trend: 0.6 }, true],
  ['Gold Room', 'la-echopark', 'Dancing', 'Club', 400, 0, 13, 10, { mult: 1, trend: 0.6 }, true],
  // --- discovered from Google Places ---
  ['Moscow Underground', 'abuja', 'Dancing', 'Club', 400, 0, 13, 30, { mult: 1, trend: 0.6 }, true],
  ['Tokyo Nightlife Abuja', 'abuja', 'Dancing', 'Club', 400, 0, 15, 18, { mult: 1, trend: 0.6 }, true],
  ['Oso Lounge', 'abuja', 'Dancing', 'Club', 400, 0, 12, 10, { mult: 1, trend: 0.6 }, true],
  ['Play Imperial Lounge', 'abuja', 'Dancing', 'Club', 400, 0, 14, 18, { mult: 1, trend: 0.6 }, true],
  ['Ibiza Nite Club', 'abuja', 'Dancing', 'Club', 400, 0, 11, 10, { mult: 1, trend: 0.6 }, true],
  ['Effex NightClub', 'albuquerque', 'Dancing', 'Club', 400, 0, 13, 10, { mult: 1, trend: 0.6 }, true],
  ['401 Nightclub', 'albuquerque', 'Dancing', 'Club', 400, 0, 8, 5, { mult: 1, trend: 0.6 }, true],
  ['Cananas', 'albuquerque', 'Dancing', 'Club', 400, 0, 10, 10, { mult: 1, trend: 0.6 }, true],
  ['Adios Mama', 'albuquerque', 'Dancing', 'Club', 400, 0, 8, 30, { mult: 1, trend: 0.6 }, true],
  ['The Library Bar & Grill', 'albuquerque', 'Dancing', 'Club', 400, 0, 15, 10, { mult: 1, trend: 0.6 }, true],
  ['KUDéTA Urban Club', 'antananarivo', 'Dancing', 'Club', 400, 0, 9, 10, { mult: 1, trend: 0.6 }, true],
  ['Taxi Be night Antananarivo', 'antananarivo', 'Dancing', 'Club', 400, 0, 9, 30, { mult: 1, trend: 0.6 }, true],
  ['Mojo Bar Tana', 'antananarivo', 'Dancing', 'Club', 400, 0, 8, 10, { mult: 1, trend: 0.6 }, true],
  ['Le Point d\'Exclamation Lounge Bar', 'antananarivo', 'Dancing', 'Club', 400, 0, 8, 10, { mult: 1, trend: 0.6 }, true],
  ['Cabaret Jao\'s Pub', 'antananarivo', 'Dancing', 'Club', 400, 0, 8, 10, { mult: 1, trend: 0.6 }, true],
  ['Icon Club Astana', 'astana', 'Dancing', 'Club', 400, 0, 10, 18, { mult: 1, trend: 0.6 }, true],
  ['Janym Soul', 'astana', 'Dancing', 'Club', 400, 0, 11, 10, { mult: 1, trend: 0.6 }, true],
  ['BLA BLA BAR', 'astana', 'Dancing', 'Club', 400, 0, 12, 30, { mult: 1, trend: 0.6 }, true],
  ['Habibi Lounge', 'astana', 'Dancing', 'Club', 400, 0, 8, 10, { mult: 1, trend: 0.6 }, true],
  ['#Fest.425.', 'astana', 'Dancing', 'Club', 400, 0, 13, 5, { mult: 1, trend: 0.6 }, true],
  ['The vip mansión', 'asuncion', 'Dancing', 'Club', 400, 0, 9, 30, { mult: 1, trend: 0.6 }, true],
  ['O\'Leary club', 'asuncion', 'Dancing', 'Club', 400, 0, 15, 10, { mult: 1, trend: 0.6 }, true],
  ['Wynwood Asunción', 'asuncion', 'Dancing', 'Club', 400, 0, 14, 10, { mult: 1, trend: 0.6 }, true],
  ['Morgan Warehouse, Nightclub', 'asuncion', 'Dancing', 'Club', 400, 0, 14, 30, { mult: 1, trend: 0.6 }, true],
  ['LUX Club', 'asuncion', 'Dancing', 'Club', 400, 0, 9, 10, { mult: 1, trend: 0.6 }, true],
  ['IBIZA CLUB / SKY', 'bamako', 'Dancing', 'Club', 400, 0, 12, 10, { mult: 1, trend: 0.6 }, true],
  ['VILLA WILDA', 'bamako', 'Dancing', 'Club', 400, 0, 14, 10, { mult: 1, trend: 0.6 }, true],
  ['Hotel Le Baobab', 'bamako', 'Dancing', 'Club', 400, 0, 15, 10, { mult: 1, trend: 0.6 }, true],
  ['Heaven Garden H.G', 'bamako', 'Bars', 'Bar', 180, 0, 9, 0, { mult: 1, trend: 0.6 }, true],
  ['LE SAVANA', 'bamako', 'Bars', 'Bar', 180, 0, 14, 0, { mult: 1, trend: 0.6 }, true],
  ['Crystal Night Club', 'belohorizonte', 'Dancing', 'Club', 400, 0, 9, 10, { mult: 1, trend: 0.6 }, true],
  ['New Sagitárius - Night Club', 'belohorizonte', 'Dancing', 'Club', 400, 0, 10, 10, { mult: 1, trend: 0.6 }, true],
  ['DDuck DClub', 'belohorizonte', 'Dancing', 'Club', 400, 0, 14, 10, { mult: 1, trend: 0.6 }, true],
  ['Clube Church', 'belohorizonte', 'Dancing', 'Club', 400, 0, 14, 10, { mult: 1, trend: 0.6 }, true],
  ['Boate Capricórnios.', 'belohorizonte', 'Dancing', 'Club', 400, 0, 8, 30, { mult: 1, trend: 0.6 }, true],
  ['Promzona Club', 'bishkek', 'Dancing', 'Club', 400, 0, 16, 10, { mult: 1, trend: 0.6 }, true],
  ['Night club "NirVana"', 'bishkek', 'Dancing', 'Club', 400, 0, 9, 10, { mult: 1, trend: 0.6 }, true],
  ['ZHARA Strip Show Bar', 'bishkek', 'Dancing', 'Club', 400, 0, 12, 30, { mult: 1, trend: 0.6 }, true],
  ['Suzie Wong', 'bishkek', 'Dancing', 'Club', 400, 0, 14, 10, { mult: 1, trend: 0.6 }, true],
  ['Стриптиз-клуб Hell', 'bishkek', 'Dancing', 'Club', 400, 0, 9, 10, { mult: 1, trend: 0.6 }, true],
  ['Humpin\' Hannah\'s', 'boise', 'Dancing', 'Club', 400, 0, 13, 5, { mult: 1, trend: 0.6 }, true],
  ['StrangeLove', 'boise', 'Dancing', 'Club', 400, 0, 12, 10, { mult: 1, trend: 0.6 }, true],
  ['The Balcony Club', 'boise', 'Dancing', 'Club', 400, 0, 12, 10, { mult: 1, trend: 0.6 }, true],
  ['Amsterdam Lounge', 'boise', 'Dancing', 'Club', 400, 0, 14, 5, { mult: 1, trend: 0.6 }, true],
  ['Dirty Little Roddy\'s', 'boise', 'Dancing', 'Club', 400, 0, 12, 5, { mult: 1, trend: 0.6 }, true],
  ['Roses Lounge', 'brasilia', 'Dancing', 'Club', 400, 0, 11, 30, { mult: 1, trend: 0.6 }, true],
  ['Star Night', 'brasilia', 'Dancing', 'Club', 400, 0, 9, 30, { mult: 1, trend: 0.6 }, true],
  ['Zeus Night Club', 'brasilia', 'Dancing', 'Club', 400, 0, 14, 10, { mult: 1, trend: 0.6 }, true],
  ['Paradise Bsb', 'brasilia', 'Dancing', 'Club', 400, 0, 8, 30, { mult: 1, trend: 0.6 }, true],
  ['Fun Haus Club Brasília', 'brasilia', 'Dancing', 'Club', 400, 0, 11, 10, { mult: 1, trend: 0.6 }, true],
  ['Gallery Calgary Nightclub', 'calgary', 'Dancing', 'Club', 400, 0, 8, 10, { mult: 1, trend: 0.6 }, true],
  ['PAPI Bar & Nightclub', 'calgary', 'Dancing', 'Club', 400, 0, 12, 10, { mult: 1, trend: 0.6 }, true],
  ['LVL Three Bar & Lounge', 'calgary', 'Dancing', 'Club', 400, 0, 13, 10, { mult: 1, trend: 0.6 }, true],
  ['Bleu Calgary', 'calgary', 'Dancing', 'Club', 400, 0, 13, 10, { mult: 1, trend: 0.6 }, true],
  ['Velvet Room YYC', 'calgary', 'Dancing', 'Club', 400, 0, 9, 10, { mult: 1, trend: 0.6 }, true],
  ['Class Lounge Curitiba', 'curitiba', 'Dancing', 'Club', 400, 0, 13, 10, { mult: 1, trend: 0.6 }, true],
  ['Club Vibe', 'curitiba', 'Dancing', 'Club', 400, 0, 13, 10, { mult: 1, trend: 0.6 }, true],
  ['RW CLUB', 'curitiba', 'Dancing', 'Club', 400, 0, 11, 10, { mult: 1, trend: 0.6 }, true],
  ['Metro Club Show - Casa Noturna', 'curitiba', 'Dancing', 'Club', 400, 0, 11, 10, { mult: 1, trend: 0.6 }, true],
  ['Lotus Sunset Lounge', 'curitiba', 'Dancing', 'Club', 400, 0, 15, 10, { mult: 1, trend: 0.6 }, true],
  ['SWITCH NIGHT-CLUB', 'douala', 'Dancing', 'Club', 400, 0, 9, 10, { mult: 1, trend: 0.6 }, true],
  ['Le Penalty Lounge', 'douala', 'Dancing', 'Club', 400, 0, 8, 10, { mult: 1, trend: 0.6 }, true],
  ['MIDNYTE CLUB', 'douala', 'Dancing', 'Club', 400, 0, 10, 10, { mult: 1, trend: 0.6 }, true],
  ['Wanda Club Douala', 'douala', 'Dancing', 'Club', 400, 0, 8, 10, { mult: 1, trend: 0.6 }, true],
  ['Panamera Lounge', 'douala', 'Dancing', 'Club', 400, 0, 9, 10, { mult: 1, trend: 0.6 }, true],
  ['101°CLUB', 'edmonton', 'Dancing', 'Club', 400, 0, 10, 10, { mult: 1, trend: 0.6 }, true],
  ['The Illusion Lounge', 'edmonton', 'Dancing', 'Club', 400, 0, 12, 10, { mult: 1, trend: 0.6 }, true],
  ['99ten', 'edmonton', 'Dancing', 'Club', 400, 0, 12, 10, { mult: 1, trend: 0.6 }, true],
  ['Discreet Lounge & Bar', 'edmonton', 'Dancing', 'Club', 400, 0, 9, 30, { mult: 1, trend: 0.6 }, true],
  ['clandestine nightclub', 'edmonton', 'Dancing', 'Club', 400, 0, 8, 10, { mult: 1, trend: 0.6 }, true],
  ['OPIUM NIGHTCLUB', 'elpaso', 'Dancing', 'Club', 400, 0, 8, 5, { mult: 1, trend: 0.6 }, true],
  ['EPIC', 'elpaso', 'Dancing', 'Club', 400, 0, 11, 5, { mult: 1, trend: 0.6 }, true],
  ['NEXDOR Nightclub', 'elpaso', 'Dancing', 'Club', 400, 0, 8, 5, { mult: 1, trend: 0.6 }, true],
  ['Club 101', 'elpaso', 'Dancing', 'Club', 400, 0, 10, 10, { mult: 1, trend: 0.6 }, true],
  ['Teddy\'s Lounge', 'elpaso', 'Dancing', 'Club', 400, 0, 11, 5, { mult: 1, trend: 0.6 }, true],
  ['Y’all Club', 'fortaleza', 'Dancing', 'Club', 400, 0, 12, 10, { mult: 1, trend: 0.6 }, true],
  ['LIV', 'fortaleza', 'Dancing', 'Club', 400, 0, 14, 10, { mult: 1, trend: 0.6 }, true],
  ['Valentina Club', 'fortaleza', 'Dancing', 'Club', 400, 0, 11, 10, { mult: 1, trend: 0.6 }, true],
  ['Kosmika Club', 'fortaleza', 'Dancing', 'Club', 400, 0, 13, 10, { mult: 1, trend: 0.6 }, true],
  ['Gandaia Bar & Club', 'fortaleza', 'Dancing', 'Club', 400, 0, 13, 10, { mult: 1, trend: 0.6 }, true],
  ['Cigar Lounge', 'gaborone', 'Dancing', 'Club', 400, 0, 8, 10, { mult: 1, trend: 0.6 }, true],
  ['Absolut Lounge', 'gaborone', 'Dancing', 'Club', 400, 0, 8, 10, { mult: 1, trend: 0.6 }, true],
  ['THE MATRIX GARDEN LOUNGE', 'gaborone', 'Dancing', 'Club', 400, 0, 8, 10, { mult: 1, trend: 0.6 }, true],
  ['Main Deck Restaurant & Bar', 'gaborone', 'Dancing', 'Club', 400, 0, 9, 10, { mult: 1, trend: 0.6 }, true],
  ['Rasmatazz', 'gaborone', 'Dancing', 'Club', 400, 0, 12, 10, { mult: 1, trend: 0.6 }, true],
  ['Big Boss Lounge', 'kinshasa', 'Dancing', 'Club', 400, 0, 8, 10, { mult: 1, trend: 0.6 }, true],
  ['Coco Jambo Lounge & Lounge', 'kinshasa', 'Dancing', 'Club', 400, 0, 9, 10, { mult: 1, trend: 0.6 }, true],
  ['Millionaire Club', 'kinshasa', 'Dancing', 'Club', 400, 0, 8, 10, { mult: 1, trend: 0.6 }, true],
  ['CARRÉ CLUB KINSHASA', 'kinshasa', 'Dancing', 'Club', 400, 0, 9, 10, { mult: 1, trend: 0.6 }, true],
  ['Spirit Club & Bar B Q', 'kinshasa', 'Dancing', 'Club', 400, 0, 10, 10, { mult: 1, trend: 0.6 }, true],
  ['Emperor Nite Club', 'kumasi', 'Dancing', 'Club', 400, 0, 8, 10, { mult: 1, trend: 0.6 }, true],
  ['P2 LOUNGE', 'kumasi', 'Dancing', 'Club', 400, 0, 9, 10, { mult: 1, trend: 0.6 }, true],
  ['THE INSIDE (KUMASI)', 'kumasi', 'Dancing', 'Club', 400, 0, 13, 10, { mult: 1, trend: 0.6 }, true],
  ['Devoid_nightclub', 'kumasi', 'Dancing', 'Club', 400, 0, 9, 10, { mult: 1, trend: 0.6 }, true],
  ['IBIZA ROOFTOP RESTAURANT AND LOUNGE', 'kumasi', 'Dancing', 'Club', 400, 0, 10, 10, { mult: 1, trend: 0.6 }, true],
  ['The Palm Room', 'louisville', 'Dancing', 'Club', 400, 0, 11, 10, { mult: 1, trend: 0.6 }, true],
  ['Coles\'s Place', 'louisville', 'Dancing', 'Club', 400, 0, 10, 5, { mult: 1, trend: 0.6 }, true],
  ['Howl at the Moon Louisville', 'louisville', 'Dancing', 'Club', 400, 0, 15, 10, { mult: 1, trend: 0.6 }, true],
  ['Jerry Green and Friends', 'louisville', 'Dancing', 'Club', 400, 0, 9, 10, { mult: 1, trend: 0.6 }, true],
  ['Play Louisville', 'louisville', 'Dancing', 'Club', 400, 0, 13, 10, { mult: 1, trend: 0.6 }, true],
  ['Platinum VIP nightclub', 'lusaka', 'Dancing', 'Club', 400, 0, 10, 10, { mult: 1, trend: 0.6 }, true],
  ['Qube Night Club', 'lusaka', 'Dancing', 'Club', 400, 0, 11, 10, { mult: 1, trend: 0.6 }, true],
  ['Cloud Lounge KCC Lusaka', 'lusaka', 'Dancing', 'Club', 400, 0, 9, 18, { mult: 1, trend: 0.6 }, true],
  ['Comfort Zone Lounge Kcc Kabwata', 'lusaka', 'Dancing', 'Club', 400, 0, 8, 10, { mult: 1, trend: 0.6 }, true],
  ['Scream Disco Nightclub', 'lusaka', 'Dancing', 'Club', 400, 0, 8, 10, { mult: 1, trend: 0.6 }, true],
  ['Black Jagger Club', 'mendoza', 'Dancing', 'Club', 400, 0, 12, 10, { mult: 1, trend: 0.6 }, true],
  ['GUTIERREZ long bar', 'mendoza', 'Dancing', 'Club', 400, 0, 17, 10, { mult: 1, trend: 0.6 }, true],
  ['Premium', 'mendoza', 'Dancing', 'Club', 400, 0, 8, 10, { mult: 1, trend: 0.6 }, true],
  ['Beat Club Mendoza', 'mendoza', 'Dancing', 'Club', 400, 0, 14, 10, { mult: 1, trend: 0.6 }, true],
  ['Wish Disco', 'mendoza', 'Dancing', 'Club', 400, 0, 13, 10, { mult: 1, trend: 0.6 }, true],
  ['L Street Lounge', 'omaha', 'Dancing', 'Club', 400, 0, 9, 10, { mult: 1, trend: 0.6 }, true],
  ['Rhythmz Lounge', 'omaha', 'Dancing', 'Club', 400, 0, 11, 5, { mult: 1, trend: 0.6 }, true],
  ['Extasis Night Club', 'omaha', 'Dancing', 'Club', 400, 0, 8, 5, { mult: 1, trend: 0.6 }, true],
  ['The Max', 'omaha', 'Dancing', 'Club', 400, 0, 13, 10, { mult: 1, trend: 0.6 }, true],
  ['American Dream', 'omaha', 'Dancing', 'Club', 400, 0, 10, 10, { mult: 1, trend: 0.6 }, true],
  ['Sky Lounge', 'ottawa', 'Dancing', 'Club', 400, 0, 12, 10, { mult: 1, trend: 0.6 }, true],
  ['The Show Ottawa', 'ottawa', 'Dancing', 'Club', 400, 0, 12, 10, { mult: 1, trend: 0.6 }, true],
  ['The 27 Club', 'ottawa', 'Dancing', 'Club', 400, 0, 11, 10, { mult: 1, trend: 0.6 }, true],
  ['City At Night', 'ottawa', 'Dancing', 'Club', 400, 0, 13, 10, { mult: 1, trend: 0.6 }, true],
  ['The Lookout Bar', 'ottawa', 'Dancing', 'Club', 400, 0, 15, 10, { mult: 1, trend: 0.6 }, true],
  ['Casablanca night club and bar', 'portharcourt', 'Dancing', 'Club', 400, 0, 11, 10, { mult: 1, trend: 0.6 }, true],
  ['The 411 Lounge', 'portharcourt', 'Dancing', 'Club', 400, 0, 15, 10, { mult: 1, trend: 0.6 }, true],
  ['Orange Room Lounge', 'portharcourt', 'Dancing', 'Club', 400, 0, 12, 10, { mult: 1, trend: 0.6 }, true],
  ['HOBNOB LOUNGE', 'portharcourt', 'Dancing', 'Club', 400, 0, 10, 10, { mult: 1, trend: 0.6 }, true],
  ['Ediz Wine Bar', 'portharcourt', 'Dancing', 'Club', 400, 0, 14, 5, { mult: 1, trend: 0.6 }, true],
  ['Dominó Night Club', 'portoalegre', 'Dancing', 'Club', 400, 0, 11, 30, { mult: 1, trend: 0.6 }, true],
  ['Uptown Club', 'portoalegre', 'Dancing', 'Club', 400, 0, 11, 10, { mult: 1, trend: 0.6 }, true],
  ['Cabaret Poa', 'portoalegre', 'Dancing', 'Club', 400, 0, 15, 10, { mult: 1, trend: 0.6 }, true],
  ['Blue Lounge Música Eletrônica em Porto Alegre', 'portoalegre', 'Dancing', 'Club', 400, 0, 11, 10, { mult: 1, trend: 0.6 }, true],
  ['Tabu', 'portoalegre', 'Dancing', 'Club', 400, 0, 14, 10, { mult: 1, trend: 0.6 }, true],
  ['Club Metrópole', 'recife', 'Dancing', 'Club', 400, 0, 18, 10, { mult: 1, trend: 0.6 }, true],
  ['Lux Nightlife Hub', 'recife', 'Dancing', 'Club', 400, 0, 9, 10, { mult: 1, trend: 0.6 }, true],
  ['CHAMPAGNE CLUB', 'recife', 'Dancing', 'Club', 400, 0, 12, 10, { mult: 1, trend: 0.6 }, true],
  ['Conchittas Bar', 'recife', 'Dancing', 'Club', 400, 0, 17, 10, { mult: 1, trend: 0.6 }, true],
  ['Beach Club Boa Viagem', 'recife', 'Dancing', 'Club', 400, 0, 9, 10, { mult: 1, trend: 0.6 }, true],
  ['Lotus Night Club', 'rosario', 'Dancing', 'Club', 400, 0, 11, 10, { mult: 1, trend: 0.6 }, true],
  ['Roxy club Rosario', 'rosario', 'Dancing', 'Club', 400, 0, 13, 10, { mult: 1, trend: 0.6 }, true],
  ['Switch Club', 'rosario', 'Dancing', 'Club', 400, 0, 11, 10, { mult: 1, trend: 0.6 }, true],
  ['Club Mercury', 'rosario', 'Dancing', 'Club', 400, 0, 11, 10, { mult: 1, trend: 0.6 }, true],
  ['Queens River', 'rosario', 'Dancing', 'Club', 400, 0, 12, 10, { mult: 1, trend: 0.6 }, true],
  ['Club Paradise', 'santacruz', 'Dancing', 'Club', 400, 0, 9, 30, { mult: 1, trend: 0.6 }, true],
  ['Queens Open Mind', 'santacruz', 'Dancing', 'Club', 400, 0, 9, 10, { mult: 1, trend: 0.6 }, true],
  ['DollhouseScz', 'santacruz', 'Dancing', 'Club', 400, 0, 10, 30, { mult: 1, trend: 0.6 }, true],
  ['Casa Blanca Internacional Club', 'santacruz', 'Dancing', 'Club', 400, 0, 8, 30, { mult: 1, trend: 0.6 }, true],
  ['Karaoke Nuvo Lounge', 'santacruz', 'Dancing', 'Club', 400, 0, 8, 10, { mult: 1, trend: 0.6 }, true],
  ['MYNT Nightclub and Boiler Room Pool Lounge', 'windhoek', 'Dancing', 'Club', 400, 0, 10, 18, { mult: 1, trend: 0.6 }, true],
  ['The Loft Nightclub', 'windhoek', 'Dancing', 'Club', 400, 0, 8, 18, { mult: 1, trend: 0.6 }, true],
  ['Club London', 'windhoek', 'Dancing', 'Club', 400, 0, 8, 10, { mult: 1, trend: 0.6 }, true],
  ['Kings Lounge', 'windhoek', 'Dancing', 'Club', 400, 0, 11, 10, { mult: 1, trend: 0.6 }, true],
  ['The prime lounge', 'windhoek', 'Dancing', 'Club', 400, 0, 9, 10, { mult: 1, trend: 0.6 }, true],
  ['Dreams Nightlife', 'winnipeg', 'Dancing', 'Club', 400, 0, 8, 5, { mult: 1, trend: 0.6 }, true],
  ['World Famous Palomino Club', 'winnipeg', 'Dancing', 'Club', 400, 0, 13, 10, { mult: 1, trend: 0.6 }, true],
  ['DIABLO', 'winnipeg', 'Dancing', 'Club', 400, 0, 11, 10, { mult: 1, trend: 0.6 }, true],
  ['Club 200', 'winnipeg', 'Dancing', 'Club', 400, 0, 12, 10, { mult: 1, trend: 0.6 }, true],
  ['Club Happenings', 'winnipeg', 'Dancing', 'Club', 400, 0, 9, 5, { mult: 1, trend: 0.6 }, true],
];

function jitter(center, seed, spreadM = 140) {
  // scatter a venue around its district centre deterministically
  const r = seededRand(seed) * spreadM;
  const theta = seededRand(seed + 'θ') * Math.PI * 2;
  const dLat = (r * Math.cos(theta)) / 111000;
  const dLng = (r * Math.sin(theta)) / (111000 * Math.cos((center.lat * Math.PI) / 180));
  return { lat: +(center.lat + dLat).toFixed(6), lng: +(center.lng + dLng).toFixed(6) };
}

// Day-of-week multiplier for expected activity (weekends run hotter & later).
export function dayFactor(dow) {
  return [0.55, 0.4, 0.45, 0.6, 0.8, 1.0, 0.95][dow] ?? 0.6; // Sun..Sat
}

// Expected check-ins per 30 min for a venue at a given moment (its historical
// baseline — the "normally 10 check-ins" figure the surge detector compares to).
export function expectedRate(venue, ts = now()) {
  const tz = cityTz(venue.city); // peakHour is local time — evaluate the curve in the venue's tz
  const h = nightHour(ts, tz);
  const dow = dayOfWeek(ts, tz);
  const curve = nightCurve(h, venue.peakHour, venue.spread);
  return venue.peakRate * curve * dayFactor(dow);
}

const slugify = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

// Seasonal (summer-only) venues, keyed by exact name. `from`/`to` are inclusive
// month numbers (1–12); outside that window the venue reads as closed for the
// season. `label` is shown on the card. These are open-air beach clubs and
// summer-resort / island venues that shut down over winter.
// One-off temporary closures (renovations, private hire, holidays). Date range is
// inclusive, ISO yyyy-mm-dd in the venue's local day. The venue reads closed for
// the whole window and shows a "reopens <date>" label.
const TEMP_CLOSURES = {
  'tintin Cocktail Bar': { from: '2026-09-07', to: '2026-09-13', label: 'Closed until Sep 14' },
};

const SEASONAL = {
  // SWEDEN — Stockholm open-air (May–Sep)
  'Trädgården':          { from: 5, to: 9,  label: 'Summer only' },
  'Under Bron':          { from: 5, to: 9,  label: 'Summer only' },
  // SPAIN — Ibiza (island season May–Oct)
  'Pacha Ibiza':         { from: 5, to: 10, label: 'Summer only' },
  'Amnesia Ibiza':       { from: 5, to: 10, label: 'Summer only' },
  'Ushuaïa':             { from: 5, to: 10, label: 'Summer only' },
  // CROATIA — Zrće beach (Pag) + Hvar
  'Papaya':              { from: 6, to: 9,  label: 'Summer only' },
  'Aquarius':            { from: 6, to: 9,  label: 'Summer only' },
  'Carpe Diem':          { from: 5, to: 10, label: 'Summer only' },
  // MONTENEGRO — Budva coast
  'Top Hill':            { from: 6, to: 9,  label: 'Summer only' },
  'Trocadero':           { from: 6, to: 9,  label: 'Summer only' },
  // ROMANIA — Mamaia (Black Sea beach clubs)
  'Fratelli Beach':      { from: 6, to: 9,  label: 'Summer only' },
  'Loft Mamaia':         { from: 6, to: 9,  label: 'Summer only' },
  'Kudos Beach':         { from: 6, to: 9,  label: 'Summer only' },
  // POLAND — Sopot (Baltic beach clubs)
  'Sfinks700':           { from: 6, to: 9,  label: 'Summer only' },
  'Koliba':              { from: 6, to: 9,  label: 'Summer only' },
  'Atelier':             { from: 6, to: 9,  label: 'Summer only' },
  // GREECE — Mykonos (Chora) — island shuts over winter
  'Scandinavian Bar':    { from: 5, to: 10, label: 'Summer only' },
  '180° Sunset Bar':     { from: 5, to: 10, label: 'Summer only' },
  "Bao's Cocktail Bar":  { from: 5, to: 10, label: 'Summer only' },
  'Void Club':           { from: 5, to: 10, label: 'Summer only' },
  'Toy Room':            { from: 5, to: 10, label: 'Summer only' },
  // GREECE — Santorini (Fira)
  'Kira Thira':          { from: 5, to: 10, label: 'Summer only' },
  'MoMix':               { from: 5, to: 10, label: 'Summer only' },
  'Two Brothers Bar':    { from: 5, to: 10, label: 'Summer only' },
  'PK Cocktail Bar':     { from: 5, to: 10, label: 'Summer only' },
  // PORTUGAL — Albufeira strip (Algarve, ~Easter–Oct)
  'Kiss Club':           { from: 5, to: 10, label: 'Summer only' },
  'Libertos':            { from: 5, to: 10, label: 'Summer only' },
  // GREECE — Zakynthos / Laganas
  'Rescue Club':         { from: 5, to: 10, label: 'Summer only' },
  'Cocktails and Dreams':{ from: 5, to: 10, label: 'Summer only' },
  // SPAIN — Magaluf (Mallorca)
  'BCM Planet Dance':    { from: 5, to: 10, label: 'Summer only' },
  "Tokio Joe's":         { from: 5, to: 10, label: 'Summer only' },
  // GREECE — Malia (Crete)
  'Zig Zag Club':        { from: 5, to: 10, label: 'Summer only' },
  'Candy Club':          { from: 5, to: 10, label: 'Summer only' },
  // CYPRUS — Ayia Napa
  'The Castle Club':     { from: 5, to: 10, label: 'Summer only' },
  'Bed Rock':            { from: 5, to: 10, label: 'Summer only' },
  // BULGARIA — Sunny Beach (Black Sea, May–Sep)
  'Cacao Beach Club':    { from: 5, to: 9,  label: 'Summer only' },
  'Bedroom Beach':       { from: 5, to: 9,  label: 'Summer only' },
  // resort clubs added later (May–Oct)
  'Waikiki':             { from: 5, to: 10, label: 'Summer only' },
  'Club Vida':           { from: 5, to: 10, label: 'Summer only' },
  'Club Tropicana':      { from: 5, to: 10, label: 'Summer only' },
  'Club Heaven':         { from: 5, to: 10, label: 'Summer only' },
  'Black N White':       { from: 5, to: 10, label: 'Summer only' },
  'Carwash':             { from: 5, to: 10, label: 'Summer only' },
  'Apollo Club':         { from: 5, to: 10, label: 'Summer only' },
};

// ---- Peak-time model -------------------------------------------------------
// Peak "night hour" (24 = midnight, 26 = 2 AM, 28 = 4 AM). Real peak times track
// the venue TYPE and the local NIGHTLIFE CULTURE (Berlin techno peaks ~4 AM,
// London clubs ~1 AM, Madrid ~3 AM, rooftops ~9 PM). Hours per city relative to a
// standard-European baseline; everything not listed = 0 (standard).
const CITY_NIGHT = {
  // Russia / Central Asia / Caucasus / more Africa / Brazil coast
  Moscow: 1, 'Saint Petersburg': 1, 'Camboriú': 1,
  Tashkent: 0.5, Almaty: 0.5, Baku: 0.5, Yerevan: 0.5,
  Dakar: 0.5, Casablanca: 0.5, 'Addis Ababa': 0.5, Durban: 0.5,
  // hyper-late techno
  Berlin: 2.5, Leipzig: 2.5,
  // late (Germany / South & SE Europe / Caucasus)
  Munich: 1.5, Hamburg: 1.5, Cologne: 1.5, Frankfurt: 1.5,
  Athens: 1.5, Thessaloniki: 1.5, Mykonos: 1.5, Santorini: 1.5, Heraklion: 1.5,
  Chania: 1.5, Patras: 1.5, Rhodes: 1.5, Corfu: 1.5,
  Madrid: 1.5, Barcelona: 1.5, Valencia: 1.5, Seville: 1.5, Ibiza: 1.5,
  Belgrade: 1.5, Tbilisi: 1.5,
  // +1 (Italy / Portugal / Balkans / Turkey / Middle East / East Asia / Caribbean)
  Rome: 1, Milan: 1, Lisbon: 1, Porto: 1, Budva: 1, Sarajevo: 1, Zagreb: 1,
  Ljubljana: 1, Bucharest: 1, Sofia: 1, Tirana: 1, Pristina: 1, 'Chișinău': 1,
  Istanbul: 1, Beirut: 1, 'Tel Aviv': 1, Tokyo: 1, Osaka: 1, Seoul: 1,
  Havana: 1, 'San Juan': 1, Lagos: 1,
  // Latin America (very late in BA)
  'Buenos Aires': 2, 'São Paulo': 1, 'Rio de Janeiro': 1, 'Bogotá': 1,
  'Medellín': 1, Lima: 1, Santiago: 1, Montevideo: 1, Cartagena: 1,
  // slightly late
  Mumbai: 0.5, Delhi: 0.5, Bangalore: 0.5, Goa: 0.5, Dubai: 0.5,
  'Mexico City': 0.5, 'Cancún': 0.5, Tulum: 0.5, 'Panama City': 0.5, 'San José': 0.5,
  'Cape Town': 0.5, Johannesburg: 0.5, Nairobi: 0.5, Marrakech: 0.5, Cairo: 0.5, Accra: 0.5,
  // earlier close (UK / Ireland / North America / Oceania)
  London: -0.5, Manchester: -0.5, Glasgow: -0.5, Leeds: -0.5, Birmingham: -0.5,
  Liverpool: -0.5, Bristol: -0.5, Newcastle: -0.5, Edinburgh: -0.5, Sheffield: -0.5,
  Cardiff: -0.5, Belfast: -0.5, Dublin: -0.5,
  'New York': -0.5, Miami: -0.5, 'Los Angeles': -0.5, 'Las Vegas': -0.5, Chicago: -0.5,
  'San Francisco': -0.5, Detroit: -0.5, Washington: -0.5, Austin: -0.5,
  'New Orleans': -0.5, Atlanta: -0.5, Montreal: -0.5, Toronto: -0.5, Vancouver: -0.5,
  Sydney: -0.5, Melbourne: -0.5, Brisbane: -0.5, Perth: -0.5, Auckland: -0.5,
};
function peakHourFor(kind, category, city, seedOffset) {
  // strongly-early seed venues (open-air / sunset / beach day parties) stay early
  if (seedOffset <= -0.7) return 20.5; // ~8:30 PM
  const base = category === 'Late Night' ? 26.5
    : kind === 'Club' ? 25.5     // ~1:30 AM
    : kind === 'Rooftop' ? 21.0  // ~9 PM
    : kind === 'Venue' ? 22.0    // live gigs earlier
    : kind === 'Wine Bar' ? 22.5
    : 23.5;                      // Bar / Cocktails ~11:30 PM
  return Math.min(29, Math.max(20, base + (CITY_NIGHT[city] || 0)));
}

export function seed() {
  db.neighborhoods = NEIGHBORHOODS.map((n) => ({ ...n }));
  const seenIds = new Set();
  db.venues = VENUE_DEFS.map(([name, hood, category, kind, capacity, peakOffset, peakRate, price, sim, verified, lgbtq, ig], i) => {
    const n = NEIGHBORHOODS.find((x) => x.id === hood);
    // stable id from name+hood so adding/removing venues never shifts other ids
    let id = slugify(name) + '_' + hood;
    while (seenIds.has(id)) id += '_2';
    seenIds.add(id);
    // apply Google-verified kind/category corrections before anything derives from
    // them (CLUBBIT_RAW_KINDS lets the audit script see the un-overridden base kind)
    const ov = process.env.CLUBBIT_RAW_KINDS ? null : KIND_OVERRIDES[id];
    if (ov) { if (ov.kind) kind = ov.kind; if (ov.category) category = ov.category; }
    const peakHour = peakHourFor(kind, category, n.city, peakOffset); // culture + type aware
    return {
      id,
      name,
      neighborhood: hood,
      neighborhoodName: n.name,
      city: n.city,
      category,
      kind,
      capacity,
      price,
      peakHour,
      spread: 1.6,
      peakRate,
      verified,
      lgbtq: !!lgbtq,
      season: SEASONAL[name] || null, // summer-only venues read closed off-season
      tempClosed: TEMP_CLOSURES[name] || null, // one-off temporary closure window
      ig: ig || null, // explicit Instagram handle override (optional)
      // fallback position only — a real Google location overrides this for
      // matched venues. Keep it tight around the (on-land) district centre so
      // unmatched pins don't scatter into rivers or the sea.
      coords: RESOLVED[id] || jitter(n.center, name, 120),
      sim,
    };
  });

  // Seed the baked Google data (real ratings + review pros/cons + descriptions) so
  // the app shows reviews without live resolution. Only where nothing is cached yet,
  // so a live refresh (when the Places key works) can still improve it.
  const t0 = now();
  for (const v of db.venues) {
    const b = BAKED_PLACES[v.id];
    if (b && !db.places[v.id]) db.places[v.id] = { ...b, confident: true, resolvedTs: t0, detailsTs: 0 };
  }
  // real weekly opening hours → the app computes open/closed live from these
  // periods + city timezone (correct at any hour), instead of the schedule guess
  for (const v of db.venues) {
    const hrs = BAKED_HOURS[v.id];
    if (!hrs) continue;
    if (!db.places[v.id]) db.places[v.id] = { confident: true, resolvedTs: t0, detailsTs: t0 };
    if (Array.isArray(hrs.periods)) db.places[v.id].periods = hrs.periods;
    if (hrs.businessStatus) db.places[v.id].businessStatus = hrs.businessStatus;
  }
  // first Google photo (keyless CDN URL) → shown next to the venue name
  for (const v of db.venues) {
    const ph = BAKED_PHOTOS[v.id];
    if (!ph) continue;
    if (!db.places[v.id]) db.places[v.id] = { confident: true, resolvedTs: t0, detailsTs: t0 };
    db.places[v.id].googlePhoto = ph;
  }
  // real Instagram URLs so the button links straight to the profile (no scraping)
  for (const v of db.venues) {
    const ig = BAKED_INSTAGRAM[v.id];
    if (!ig) continue;
    if (!db.places[v.id]) db.places[v.id] = { confident: false, resolvedTs: t0, detailsTs: t0 };
    db.places[v.id].instagram = ig;
  }

  // Ambient/backfill simulation is disabled — the radar shows only REAL user
  // reports & check-ins now (crowd levels otherwise come from the honest estimate
  // model, not fabricated activity). Re-enable backfill() here to restore the demo.
  // if (db.checkins.length === 0 && db.reports.length === 0) backfill();
}

// Generate a believable last-90-minutes of anonymous activity following each
// venue's baseline, with per-venue surge/cooling trajectories for a lively map.
function backfill() {
  const t0 = now();
  const VIBE_BY_LOAD = [
    [0.15, 'dead'], [0.4, 'chill'], [0.72, 'popping'], [1.1, 'packed'],
  ];
  for (const v of db.venues) {
    // walk backward in 5-min steps over 90 min
    for (let ageMin = 90; ageMin >= 0; ageMin -= 5) {
      const ts = t0 - ageMin * MIN;
      const base = expectedRate(v, ts) * v.sim.mult;
      // trajectory: recent minutes scaled by trend so momentum reads correctly
      const recency = 1 - ageMin / 90; // 0 (old) .. 1 (now)
      const trendMult = 1 + v.sim.trend * (recency - 0.5) * 1.6;
      const per5 = (base / 6) * Math.max(0.05, trendMult); // per 5-min slice
      const noise = 0.6 + seededRand(v.id + ageMin) * 0.9;
      const count = Math.round(per5 * noise);
      for (let k = 0; k < count; k++) {
        const uHash = anonHash('sim', v.id, ageMin, k, 'u');
        db.checkins.push({
          id: randId('ci'),
          venueId: v.id,
          uHash,
          dHash: anonHash('sim-dev', v.id, k % 30),
          ts: ts - Math.floor(seededRand(uHash) * 5 * MIN),
          coords: v.coords,
          accepted: true,
          weight: 0.85,
          reason: 'ok',
          sim: true,
        });
      }
    }
    // a few recent community reports whose vibe tracks the venue's current load
    const loadNow = (expectedRate(v, t0) * v.sim.mult) / (v.peakRate || 1);
    const reportCount = 1 + Math.floor(seededRand(v.id + 'r') * 3);
    for (let k = 0; k < reportCount; k++) {
      // keep the freshest report very recent (1–4 min) so hot venues read live
      const ageMin = k === 0 ? 1 + Math.floor(seededRand(v.id + 'ra0') * 3) : 8 + Math.floor(seededRand(v.id + 'ra' + k) * 32);
      const load = loadNow * (0.8 + seededRand(v.id + 'l' + k) * 0.5);
      const vibe = VIBE_BY_LOAD.find(([thr]) => load <= thr)?.[1] || 'packed';
      db.reports.push({
        id: randId('rp'),
        venueId: v.id,
        uHash: anonHash('sim-reporter', v.id, k),
        dHash: anonHash('sim-dev', v.id, k),
        ts: t0 - ageMin * MIN,
        coords: v.coords,
        vibe,
        queue: v.price > 0 && load > 0.7 ? ['none', '<10', '10-20', '20-30'][Math.floor(seededRand(v.id + 'q' + k) * 4)] : 'none',
        entry: v.price,
        mix: ['more_women', 'even', 'more_men'][Math.floor(seededRand(v.id + 'm' + k) * 3)],
        music: pickMusic(v),
        confidence: (loadNow > 0.8 ? 0.9 : loadNow > 0.6 ? 0.72 : 0.55) + seededRand(v.id + 'c' + k) * 0.08,
        sim: true,
      });
    }
    // verified venues push an owner update; busy ones get a special (event impact)
    if (v.verified) {
      const status = loadNow > 0.9 ? 'packed' : loadNow > 0.65 ? 'popping' : loadNow > 0.35 ? 'busy' : 'quiet';
      db.ownerUpdates.push({
        id: randId('ou'),
        venueId: v.id,
        ts: t0 - (2 + Math.floor(seededRand(v.id + 'ou') * 12)) * MIN,
        status,
        queue: status === 'packed' ? '10-20' : 'none',
        entry: v.price,
        specials: v.price > 0 && loadNow > 0.7 ? `Free entry before midnight` : (v.price > 0 && seededRand(v.id + 's') > 0.5 ? `${formatMoney(Math.max(1, v.price - 5), v.city)} before 1 AM` : ''),
        lastEntry: v.price > 0 ? '3:30 AM' : '',
        music: pickMusic(v),
      });
    }
  }

  seedFeed(t0);
}

// Prime the RADAR FEED so it reads as alive the moment the app opens.
function seedFeed(t0) {
  const byLoad = [...db.venues]
    .map((v) => ({ v, load: (expectedRate(v, t0) * v.sim.mult) / (v.peakRate || 1), trend: v.sim.trend }))
    .sort((a, b) => b.load - a.load);
  const surging = byLoad.filter((x) => x.trend > 0.6).slice(0, 3);
  const packed = byLoad.filter((x) => x.load > 0.95).slice(0, 3);
  const items = [];
  surging.forEach((x, i) =>
    items.push({ ts: t0 - (3 + i * 5) * MIN, venueId: x.v.id, kind: 'surge', text: `${x.v.name} is SURGING`, sub: `+${28 + Math.floor(seededRand(x.v.id + 'fs') * 30)}% activity`, area: x.v.neighborhoodName })
  );
  packed.forEach((x, i) =>
    items.push({ ts: t0 - (6 + i * 7) * MIN, venueId: x.v.id, kind: 'vibe', text: `${x.v.name} changed to PACKED`, area: x.v.neighborhoodName })
  );
  // an area-level line + a special + a queue note
  const hotHood = db.neighborhoods[0];
  items.push({ ts: t0 - 9 * MIN, kind: 'area', text: `3 venues in ${hotHood.name} are heating up`, area: hotHood.name });
  const special = db.venues.find((v) => v.price > 0 && v.verified);
  if (special) items.push({ ts: t0 - 14 * MIN, venueId: special.id, kind: 'special', text: `Free entry announced at ${special.name} until midnight`, area: special.neighborhoodName });
  const queued = packed[0];
  if (queued) items.push({ ts: t0 - 17 * MIN, venueId: queued.v.id, kind: 'queue', text: `${queued.v.name} now has a 20+ min queue`, area: queued.v.neighborhoodName });

  items.sort((a, b) => a.ts - b.ts).forEach((it) => db.feed.push({ id: randId('f'), ...it }));
  // prime prevState so the live detector doesn't re-announce everything at once
}

function pickMusic(v) {
  const pools = {
    Club: ['House', 'Tech House', 'Techno'],
    Bar: ['House', 'Hip-Hop', 'R&B', 'Commercial'],
    Rooftop: ['House', 'Commercial', 'R&B'],
    Venue: ['Live', 'Rock', 'Afrobeats'],
    'Wine Bar': ['Jazz', 'Soul'],
  };
  const pool = pools[v.kind] || ['House'];
  return pool[Math.floor(seededRand(v.id + 'mus') * pool.length)];
}
