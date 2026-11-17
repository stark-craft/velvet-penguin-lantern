// Sampark World Explorer: an editorial index of official Samsung newsroom sources.
// Snapshot of the worldwide Samsung sources configured in news_scrapper/config/sites.json.
// This is a frontend presentation lookup, not a replacement for server-side channel routing.
export const WORLD_REGIONS = Object.freeze([
  { id: 'asia-pacific', name: 'Asia & Pacific', source: 'Asia-Pacific', description: 'Innovation, devices and research across Asia and Oceania.' },
  { id: 'europe', name: 'Europe', source: 'Europe', description: 'Technology, design and regional Samsung stories.' },
  { id: 'north-america', name: 'North America', source: 'North America', description: 'Product, enterprise and consumer technology updates.' },
  { id: 'latin-america', name: 'Latin America', source: 'Latin America', description: 'Local launches, partnerships and regional developments.' },
  { id: 'africa', name: 'Africa', source: 'Africa', description: 'Samsung initiatives and technology news from the region.' },
  { id: 'middle-east', name: 'Middle East', source: 'Middle East', description: 'Regional announcements and enterprise innovation.' },
]);

export const OFFICIAL_WORLD_SOURCES = Object.freeze([
  {
    "name": "Samsung Newsroom South Africa",
    "code": "ZA",
    "region": "Africa",
    "type": "country",
    "language": "en"
  },
  {
    "name": "Samsung Newsroom Middle East & North Africa",
    "code": "",
    "region": "Middle East",
    "type": "regional",
    "language": "ar"
  },
  {
    "name": "Samsung Newsroom Australia",
    "code": "AU",
    "region": "Asia-Pacific",
    "type": "country",
    "language": "en"
  },
  {
    "name": "Samsung Newsroom Indonesia",
    "code": "ID",
    "region": "Asia-Pacific",
    "type": "country",
    "language": "id"
  },
  {
    "name": "Samsung Newsroom Japan",
    "code": "JP",
    "region": "Asia-Pacific",
    "type": "country",
    "language": "ja"
  },
  {
    "name": "Samsung Newsroom Korea",
    "code": "KR",
    "region": "Asia-Pacific",
    "type": "country",
    "language": "ko"
  },
  {
    "name": "Samsung Newsroom Malaysia",
    "code": "MY",
    "region": "Asia-Pacific",
    "type": "country",
    "language": "en"
  },
  {
    "name": "Samsung Newsroom Philippines",
    "code": "PH",
    "region": "Asia-Pacific",
    "type": "country",
    "language": "en"
  },
  {
    "name": "Samsung Newsroom Singapore",
    "code": "SG",
    "region": "Asia-Pacific",
    "type": "country",
    "language": "en"
  },
  {
    "name": "Samsung Newsroom Taiwan",
    "code": "TW",
    "region": "Asia-Pacific",
    "type": "country",
    "language": "zh-Hant"
  },
  {
    "name": "Samsung Newsroom Thailand",
    "code": "TH",
    "region": "Asia-Pacific",
    "type": "country",
    "language": "th"
  },
  {
    "name": "Samsung Newsroom Vietnam",
    "code": "VN",
    "region": "Asia-Pacific",
    "type": "country",
    "language": "vi"
  },
  {
    "name": "Samsung Newsroom Austria",
    "code": "AT",
    "region": "Europe",
    "type": "country",
    "language": "de"
  },
  {
    "name": "Samsung Newsroom Belgium",
    "code": "BE",
    "region": "Europe",
    "type": "country",
    "language": "nl"
  },
  {
    "name": "Samsung Newsroom Belgium (French)",
    "code": "BE",
    "region": "Europe",
    "type": "country",
    "language": "fr"
  },
  {
    "name": "Samsung Newsroom Czech Republic",
    "code": "CZ",
    "region": "Europe",
    "type": "country",
    "language": "cs"
  },
  {
    "name": "Samsung Newsroom France",
    "code": "FR",
    "region": "Europe",
    "type": "country",
    "language": "fr"
  },
  {
    "name": "Samsung Newsroom Germany",
    "code": "DE",
    "region": "Europe",
    "type": "country",
    "language": "de"
  },
  {
    "name": "Samsung Newsroom Italy",
    "code": "IT",
    "region": "Europe",
    "type": "country",
    "language": "it"
  },
  {
    "name": "Samsung Newsroom Kazakhstan (Kazakh)",
    "code": "KZ",
    "region": "Europe",
    "type": "country",
    "language": "kk"
  },
  {
    "name": "Samsung Newsroom Kazakhstan (Russian)",
    "code": "KZ",
    "region": "Europe",
    "type": "country",
    "language": "ru"
  },
  {
    "name": "Samsung Newsroom Netherlands",
    "code": "NL",
    "region": "Europe",
    "type": "country",
    "language": "nl"
  },
  {
    "name": "Samsung Newsroom Norway",
    "code": "NO",
    "region": "Europe",
    "type": "country",
    "language": "no"
  },
  {
    "name": "Samsung Newsroom Poland",
    "code": "PL",
    "region": "Europe",
    "type": "country",
    "language": "pl"
  },
  {
    "name": "Samsung Newsroom Romania",
    "code": "RO",
    "region": "Europe",
    "type": "country",
    "language": "ro"
  },
  {
    "name": "Samsung Newsroom Russia",
    "code": "RU",
    "region": "Europe",
    "type": "country",
    "language": "ru"
  },
  {
    "name": "Samsung Newsroom Spain",
    "code": "ES",
    "region": "Europe",
    "type": "country",
    "language": "es"
  },
  {
    "name": "Samsung Newsroom Sweden",
    "code": "SE",
    "region": "Europe",
    "type": "country",
    "language": "sv"
  },
  {
    "name": "Samsung Newsroom Switzerland (German)",
    "code": "CH",
    "region": "Europe",
    "type": "country",
    "language": "de"
  },
  {
    "name": "Samsung Newsroom Switzerland (French)",
    "code": "CH",
    "region": "Europe",
    "type": "country",
    "language": "fr"
  },
  {
    "name": "Samsung Newsroom Türkiye",
    "code": "TR",
    "region": "Europe",
    "type": "country",
    "language": "tr"
  },
  {
    "name": "Samsung Newsroom Ukraine",
    "code": "UA",
    "region": "Europe",
    "type": "country",
    "language": "uk"
  },
  {
    "name": "Samsung Newsroom United Kingdom",
    "code": "GB",
    "region": "Europe",
    "type": "country",
    "language": "en"
  },
  {
    "name": "Samsung Newsroom Uzbekistan",
    "code": "UZ",
    "region": "Europe",
    "type": "country",
    "language": "uz"
  },
  {
    "name": "Samsung Newsroom Argentina",
    "code": "AR",
    "region": "Latin America",
    "type": "country",
    "language": "es"
  },
  {
    "name": "Samsung Newsroom Brazil",
    "code": "BR",
    "region": "Latin America",
    "type": "country",
    "language": "pt-BR"
  },
  {
    "name": "Samsung Newsroom Chile",
    "code": "CL",
    "region": "Latin America",
    "type": "country",
    "language": "es"
  },
  {
    "name": "Samsung Newsroom Colombia",
    "code": "CO",
    "region": "Latin America",
    "type": "country",
    "language": "es"
  },
  {
    "name": "Samsung Newsroom Latin America",
    "code": "",
    "region": "Latin America",
    "type": "regional",
    "language": "es"
  },
  {
    "name": "Samsung Newsroom Mexico",
    "code": "MX",
    "region": "Latin America",
    "type": "country",
    "language": "es"
  },
  {
    "name": "Samsung Newsroom Peru",
    "code": "PE",
    "region": "Latin America",
    "type": "country",
    "language": "es"
  },
  {
    "name": "Samsung Newsroom Canada",
    "code": "CA",
    "region": "North America",
    "type": "country",
    "language": "en"
  },
  {
    "name": "Samsung Newsroom Canada (French)",
    "code": "CA",
    "region": "North America",
    "type": "country",
    "language": "fr"
  },
  {
    "name": "Samsung Newsroom United States",
    "code": "US",
    "region": "North America",
    "type": "country",
    "language": "en"
  },
  {
    "name": "Samsung Semiconductor Newsroom",
    "code": "",
    "region": "Global",
    "type": "business",
    "language": "en"
  },
  {
    "name": "Samsung Display Newsroom",
    "code": "",
    "region": "Global",
    "type": "business",
    "language": "en"
  },
  {
    "name": "Samsung SDI Newsroom",
    "code": "",
    "region": "Global",
    "type": "business",
    "language": "en"
  },
  {
    "name": "Samsung Electro-Mechanics Newsroom",
    "code": "",
    "region": "Global",
    "type": "business",
    "language": "en"
  }
]);

const REGION_IDS = new Map(WORLD_REGIONS.map((region) => [region.source, region.id]));
const MARKET_NAMES = {
  KR: 'South Korea', TW: 'Taiwan', CZ: 'Czech Republic',
  TR: 'Türkiye', GB: 'United Kingdom', US: 'United States',
};
const SOURCE_BY_NAME = new Map(OFFICIAL_WORLD_SOURCES.map((entry) => [normalizeSource(entry.name), entry]));
const MARKETS = new Map();

function normalizeSource(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function marketName(code) {
  if (MARKET_NAMES[code]) return MARKET_NAMES[code];
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) || code;
  } catch {
    return code;
  }
}

for (const entry of OFFICIAL_WORLD_SOURCES) {
  if (entry.type !== 'country' || !entry.code || !REGION_IDS.has(entry.region)) continue;
  if (!MARKETS.has(entry.code)) {
    MARKETS.set(entry.code, {
      code: entry.code,
      name: marketName(entry.code),
      regionId: REGION_IDS.get(entry.region),
      sources: [],
    });
  }
  MARKETS.get(entry.code).sources.push(entry.name);
}

export const WORLD_MARKETS = Object.freeze([...MARKETS.values()].sort((a, b) => a.name.localeCompare(b.name)));
export const WORLD_DESKS = Object.freeze(OFFICIAL_WORLD_SOURCES.filter((entry) => entry.type === 'business'));
export const WORLD_REGIONAL_DESKS = Object.freeze(OFFICIAL_WORLD_SOURCES.filter((entry) => entry.type === 'regional'));

function sourceNames(article) {
  const nested = article?.sources || article?.source_list || [];
  return [
    article?.source,
    article?.src,
    article?.source_name,
    article?.site_name,
    article?.publisher,
    ...(Array.isArray(nested) ? nested.map((item) => typeof item === 'string'
      ? item
      : (item?.name || item?.source || item?.publisher || '')) : []),
  ].map(normalizeSource).filter(Boolean);
}

export function worldArticleLocation(article) {
  // Primary source takes precedence over secondary sources from merged stories.
  for (const name of sourceNames(article)) {
    const source = SOURCE_BY_NAME.get(name);
    if (!source) continue;
    if (source.type === 'business') return { kind: 'business', id: source.name };
    if (source.type === 'regional') return { kind: 'regional', id: source.name };
    if (source.type === 'country' && source.code !== 'IN') return { kind: 'country', id: source.code };
  }
  // The pipeline may preserve structured newsroom metadata when the publisher
  // label has changed during enrichment or semantic clustering.
  const code = String(article?.newsroom_country || '').trim().toUpperCase();
  if (code && code !== 'IN' && MARKETS.has(code)) return { kind: 'country', id: code };
  return { kind: 'worldwide', id: 'worldwide' };
}

export function buildWorldCoverage(articles) {
  const all = Array.isArray(articles) ? articles : [];
  const byCountry = Object.fromEntries(WORLD_MARKETS.map(({ code }) => [code, []]));
  const byBusiness = Object.fromEntries(WORLD_DESKS.map(({ name }) => [name, []]));
  const byRegional = Object.fromEntries(WORLD_REGIONAL_DESKS.map(({ name }) => [name, []]));
  const worldwide = [];
  for (const article of all) {
    const destination = worldArticleLocation(article);
    if (destination.kind === 'country') byCountry[destination.id].push(article);
    else if (destination.kind === 'business') byBusiness[destination.id].push(article);
    else if (destination.kind === 'regional') byRegional[destination.id].push(article);
    else worldwide.push(article);
  }
  const regions = WORLD_REGIONS.map((region) => {
    const countries = WORLD_MARKETS.filter((market) => market.regionId === region.id).map((market) => ({
      ...market, articles: byCountry[market.code], count: byCountry[market.code].length,
    })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    const regionalDesks = WORLD_REGIONAL_DESKS.filter((desk) => REGION_IDS.get(desk.region) === region.id)
      .map((desk) => ({ ...desk, articles: byRegional[desk.name], count: byRegional[desk.name].length }));
    return {
      ...region,
      countries,
      regionalDesks,
      articleCount: countries.reduce((sum, country) => sum + country.count, 0)
        + regionalDesks.reduce((sum, desk) => sum + desk.count, 0),
      activeCountries: countries.filter((country) => country.count > 0).length,
    };
  });
  return {
    all, regions, byCountry, byBusiness, byRegional, worldwide,
    businesses: WORLD_DESKS.map((desk) => ({ ...desk, articles: byBusiness[desk.name], count: byBusiness[desk.name].length })),
    marketCount: WORLD_MARKETS.length,
  };
}
