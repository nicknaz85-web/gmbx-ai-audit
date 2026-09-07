// money.js — show each venue's entry price in its own local currency.
// Seed/report prices are stored as a EUR base amount; here we map the venue's
// city to a currency and convert + format for display. Rates are fixed
// approximations (this is a nightlife guide, not an FX desk).

// Cities NOT on the euro. Everything else (incl. Slovakia, Croatia, Montenegro,
// Kosovo, Portugal, Ireland…) uses EUR by default.
const CURRENCY_BY_CITY = {
  // United Kingdom — GBP
  London: 'GBP', Manchester: 'GBP', Glasgow: 'GBP', Leeds: 'GBP', Birmingham: 'GBP',
  Liverpool: 'GBP', Bristol: 'GBP', Newcastle: 'GBP', Edinburgh: 'GBP', Sheffield: 'GBP',
  Cardiff: 'GBP', Belfast: 'GBP',
  // Poland — PLN
  Warsaw: 'PLN', 'Kraków': 'PLN', Sopot: 'PLN', 'Poznań': 'PLN',
  // Czechia — CZK
  Prague: 'CZK',
  // Hungary — HUF
  Budapest: 'HUF',
  // Romania — RON
  Bucharest: 'RON', Mamaia: 'RON',
  // Serbia — RSD
  Belgrade: 'RSD',
  // Moldova — MDL
  'Chișinău': 'MDL',
  // Bosnia — BAM
  Sarajevo: 'BAM',
  // Albania — ALL
  Tirana: 'ALL',
  // Switzerland — CHF (Austria & Slovenia are on the euro)
  Zurich: 'CHF', Geneva: 'CHF',
  // Nordics & Bulgaria (Finland & Ireland are on the euro)
  Copenhagen: 'DKK', Stockholm: 'SEK', Oslo: 'NOK', Sofia: 'BGN',
  // North America
  'New York': 'USD', Miami: 'USD', 'Los Angeles': 'USD', 'Las Vegas': 'USD', Chicago: 'USD',
  'Panama City': 'USD', Montreal: 'CAD', Toronto: 'CAD',
  'Mexico City': 'MXN', 'Cancún': 'MXN', Tulum: 'MXN', 'San José': 'CRC',
  // South America
  'São Paulo': 'BRL', 'Rio de Janeiro': 'BRL', 'Buenos Aires': 'ARS',
  'Bogotá': 'COP', 'Medellín': 'COP', Lima: 'PEN', Santiago: 'CLP',
  // Asia / Middle East / Oceania / Africa
  Bangkok: 'THB', Tokyo: 'JPY', Osaka: 'JPY', Seoul: 'KRW',
  'Ho Chi Minh City': 'VND', Hanoi: 'VND', Bali: 'IDR', Singapore: 'SGD',
  Dubai: 'AED', 'Tel Aviv': 'ILS', Istanbul: 'TRY', Minsk: 'BYN',
  Sydney: 'AUD', Melbourne: 'AUD', 'Cape Town': 'ZAR',
  // India / China / rest of Asia
  Mumbai: 'INR', Delhi: 'INR', Bangalore: 'INR', Goa: 'INR',
  Shanghai: 'CNY', Beijing: 'CNY', Chengdu: 'CNY', Shenzhen: 'CNY', 'Hong Kong': 'HKD',
  Taipei: 'TWD', 'Kuala Lumpur': 'MYR', Manila: 'PHP', Jakarta: 'IDR',
  // Middle East / Africa
  Beirut: 'USD', Cairo: 'EGP', Lagos: 'NGN', Nairobi: 'KES', Marrakech: 'MAD',
  Johannesburg: 'ZAR', Accra: 'GHS',
  // North America (more) — USD & CAD
  'San Francisco': 'USD', Detroit: 'USD', Washington: 'USD', Austin: 'USD',
  'New Orleans': 'USD', Atlanta: 'USD', Vancouver: 'CAD',
  // Latin America / Caribbean (more)
  Montevideo: 'UYU', Cartagena: 'COP', Havana: 'USD', 'San Juan': 'USD',
  // Oceania (more)
  Brisbane: 'AUD', Perth: 'AUD', Auckland: 'NZD',
  // Europe (more) — Iceland/Georgia/Ukraine (Zagreb is euro, default)
  Reykjavik: 'ISK', Tbilisi: 'GEL', Kyiv: 'UAH',
  // Russia + Central Asia + Caucasus
  Moscow: 'RUB', 'Saint Petersburg': 'RUB', Tashkent: 'UZS', Almaty: 'KZT',
  Baku: 'AZN', Yerevan: 'AMD',
  // Africa (more) — Casablanca/Durban already MAD/ZAR
  Dakar: 'XOF', 'Addis Ababa': 'ETB',
  // South America (more) — Camboriú is real (BRL)
  'Camboriú': 'BRL',
};

// symbol · pre (symbol before the number?) · rate (EUR→local) · step (rounding)
const CUR = {
  EUR: { code: 'EUR', symbol: '€',   pre: true,  rate: 1,    step: 1 },
  GBP: { code: 'GBP', symbol: '£',   pre: true,  rate: 0.86, step: 1 },
  PLN: { code: 'PLN', symbol: 'zł',  pre: false, rate: 4.3,  step: 5 },
  CZK: { code: 'CZK', symbol: 'Kč',  pre: false, rate: 25,   step: 10 },
  HUF: { code: 'HUF', symbol: 'Ft',  pre: false, rate: 395,  step: 100 },
  RON: { code: 'RON', symbol: 'lei', pre: false, rate: 5.0,  step: 5 },
  RSD: { code: 'RSD', symbol: 'din', pre: false, rate: 117,  step: 100 },
  MDL: { code: 'MDL', symbol: 'L',   pre: false, rate: 19.5, step: 10 },
  BAM: { code: 'BAM', symbol: 'KM',  pre: false, rate: 1.96, step: 1 },
  ALL: { code: 'ALL', symbol: 'Lek', pre: false, rate: 100,  step: 100 },
  CHF: { code: 'CHF', symbol: 'CHF ', pre: true, rate: 0.95, step: 1 },
  DKK: { code: 'DKK', symbol: 'kr',  pre: false, rate: 7.45, step: 10 },
  SEK: { code: 'SEK', symbol: 'kr',  pre: false, rate: 11.3, step: 10 },
  NOK: { code: 'NOK', symbol: 'kr',  pre: false, rate: 11.7, step: 10 },
  BGN: { code: 'BGN', symbol: 'lv',  pre: false, rate: 1.96, step: 1 },
  USD: { code: 'USD', symbol: '$',   pre: true,  rate: 1.08,  step: 5 },
  CAD: { code: 'CAD', symbol: 'C$',  pre: true,  rate: 1.47,  step: 5 },
  MXN: { code: 'MXN', symbol: '$',   pre: true,  rate: 18.5,  step: 20 },
  CRC: { code: 'CRC', symbol: '₡',   pre: true,  rate: 560,   step: 1000 },
  BRL: { code: 'BRL', symbol: 'R$',  pre: true,  rate: 5.9,   step: 5 },
  ARS: { code: 'ARS', symbol: '$',   pre: true,  rate: 1150,  step: 500 },
  COP: { code: 'COP', symbol: '$',   pre: true,  rate: 4600,  step: 5000 },
  PEN: { code: 'PEN', symbol: 'S/',  pre: true,  rate: 4.0,   step: 5 },
  CLP: { code: 'CLP', symbol: '$',   pre: true,  rate: 1000,  step: 1000 },
  THB: { code: 'THB', symbol: '฿',   pre: true,  rate: 39,    step: 50 },
  JPY: { code: 'JPY', symbol: '¥',   pre: true,  rate: 160,   step: 500 },
  KRW: { code: 'KRW', symbol: '₩',   pre: true,  rate: 1450,  step: 1000 },
  VND: { code: 'VND', symbol: '₫',   pre: false, rate: 27000, step: 10000 },
  IDR: { code: 'IDR', symbol: 'Rp',  pre: true,  rate: 17500, step: 25000 },
  SGD: { code: 'SGD', symbol: 'S$',  pre: true,  rate: 1.45,  step: 5 },
  AED: { code: 'AED', symbol: 'AED ',pre: true,  rate: 3.95,  step: 10 },
  ILS: { code: 'ILS', symbol: '₪',   pre: true,  rate: 4.0,   step: 10 },
  TRY: { code: 'TRY', symbol: '₺',   pre: true,  rate: 38,    step: 50 },
  BYN: { code: 'BYN', symbol: 'Br',  pre: false, rate: 3.5,   step: 5 },
  AUD: { code: 'AUD', symbol: 'A$',  pre: true,  rate: 1.63,  step: 5 },
  ZAR: { code: 'ZAR', symbol: 'R',   pre: true,  rate: 20,    step: 20 },
  INR: { code: 'INR', symbol: '₹',   pre: true,  rate: 97,    step: 100 },
  CNY: { code: 'CNY', symbol: '¥',   pre: true,  rate: 7.8,   step: 10 },
  HKD: { code: 'HKD', symbol: 'HK$', pre: true,  rate: 8.4,   step: 20 },
  TWD: { code: 'TWD', symbol: 'NT$', pre: true,  rate: 34,    step: 100 },
  MYR: { code: 'MYR', symbol: 'RM',  pre: true,  rate: 5.1,   step: 5 },
  PHP: { code: 'PHP', symbol: '₱',   pre: true,  rate: 61,    step: 100 },
  EGP: { code: 'EGP', symbol: 'E£',  pre: true,  rate: 53,    step: 50 },
  NGN: { code: 'NGN', symbol: '₦',   pre: true,  rate: 1700,  step: 1000 },
  KES: { code: 'KES', symbol: 'KSh', pre: true,  rate: 140,   step: 100 },
  MAD: { code: 'MAD', symbol: 'MAD ',pre: true,  rate: 10.7,  step: 10 },
  GHS: { code: 'GHS', symbol: 'GH₵', pre: true,  rate: 16,    step: 10 },
  UYU: { code: 'UYU', symbol: '$U',  pre: true,  rate: 43,    step: 50 },
  NZD: { code: 'NZD', symbol: 'NZ$', pre: true,  rate: 1.8,   step: 5 },
  ISK: { code: 'ISK', symbol: 'kr',  pre: false, rate: 150,   step: 500 },
  GEL: { code: 'GEL', symbol: '₾',   pre: true,  rate: 2.9,   step: 5 },
  UAH: { code: 'UAH', symbol: '₴',   pre: true,  rate: 45,    step: 50 },
  RUB: { code: 'RUB', symbol: '₽',   pre: false, rate: 95,    step: 100 },
  UZS: { code: 'UZS', symbol: 'soʻm',pre: false, rate: 13500, step: 10000 },
  KZT: { code: 'KZT', symbol: '₸',   pre: true,  rate: 540,   step: 500 },
  AZN: { code: 'AZN', symbol: '₼',   pre: true,  rate: 1.85,  step: 5 },
  AMD: { code: 'AMD', symbol: '֏',   pre: true,  rate: 420,   step: 500 },
  XOF: { code: 'XOF', symbol: 'CFA ',pre: true,  rate: 656,   step: 500 },
  ETB: { code: 'ETB', symbol: 'Br',  pre: false, rate: 135,   step: 50 },
};

export function currencyInfo(city) {
  return CUR[CURRENCY_BY_CITY[city] || 'EUR'];
}

// Format a EUR base amount in a city's local currency. 0 → "Free", null → null.
export function formatMoney(eur, city) {
  if (eur == null) return null;
  if (eur === 0) return 'Free';
  const c = currencyInfo(city);
  const amt = Math.max(c.step, Math.round((eur * c.rate) / c.step) * c.step);
  return c.pre ? `${c.symbol}${amt}` : `${amt} ${c.symbol}`;
}
