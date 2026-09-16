// Free, no-IP-allowlist food lookup combining two public databases:
// - USDA FoodData Central: strong on generic/whole foods, free instant API key,
//   no IP restriction (https://fdc.nal.usda.gov).
// - Open Food Facts: crowdsourced, strong on branded/packaged foods, fully open,
//   no API key at all -- just requires a real User-Agent identifying the app
//   (https://openfoodfacts.org).
// Replaces the FatSecret integration, which requires a paid Vercel Static IP
// ($100/mo) to satisfy its mandatory IP allowlist on serverless deployments.

export type FoodSearchResult = {
  source: 'usda' | 'openfoodfacts';
  externalId: string;
  foodName: string;
  brandName: string | null;
  servingDescription: string;
  calories: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
};

const USDA_SEARCH_URL = 'https://api.nal.usda.gov/fdc/v1/foods/search';
// The legacy /cgi/search.pl endpoint (vs. /api/v2/search) returns far more
// relevant results when combined with a country filter -- v2's default
// relevance ranking surfaces unrelated international products first.
const OFF_SEARCH_URL = 'https://world.openfoodfacts.org/cgi/search.pl';
const OFF_USER_AGENT = 'PearlPlayerDevelopment/1.0 (contact: info@pitchingcoachu.com)';

// USDA's stable numeric nutrient codes (consistent across all foods, unlike
// nutrientName which has minor wording variants like "Energy" vs "Energy (Atwater...)").
const USDA_NUTRIENT_NUMBERS = { protein: '203', fat: '204', carbs: '205', energy: '208' };

function usdaConfigured(): boolean {
  return Boolean(process.env.USDA_FDC_API_KEY);
}

async function searchUsda(query: string, maxResults: number): Promise<FoodSearchResult[]> {
  if (!usdaConfigured()) return [];
  const url = new URL(USDA_SEARCH_URL);
  url.searchParams.set('query', query);
  url.searchParams.set('api_key', String(process.env.USDA_FDC_API_KEY));
  url.searchParams.set('pageSize', String(Math.min(25, Math.max(1, maxResults))));
  url.searchParams.set('dataType', 'Foundation,SR Legacy,Branded');

  const response = await fetch(url.toString(), { cache: 'no-store' });
  if (!response.ok) {
    console.error('[food-db] USDA search failed:', response.status, await response.text().catch(() => ''));
    return [];
  }
  const payload = (await response.json()) as {
    foods?: Array<{
      fdcId: number;
      description: string;
      brandOwner?: string;
      brandName?: string;
      servingSize?: number;
      servingSizeUnit?: string;
      householdServingFullText?: string;
      foodNutrients?: Array<{ nutrientNumber?: string; value?: number }>;
    }>;
  };

  return (payload.foods ?? []).map((food) => {
    const nutrient = (number: string) => food.foodNutrients?.find((item) => item.nutrientNumber === number)?.value ?? null;
    const servingDescription =
      food.householdServingFullText ||
      (food.servingSize && food.servingSizeUnit ? `${food.servingSize} ${food.servingSizeUnit}` : 'per 100g');
    return {
      source: 'usda' as const,
      externalId: `usda:${food.fdcId}`,
      foodName: food.description,
      brandName: food.brandOwner || food.brandName || null,
      servingDescription,
      calories: nutrient(USDA_NUTRIENT_NUMBERS.energy),
      proteinG: nutrient(USDA_NUTRIENT_NUMBERS.protein),
      carbsG: nutrient(USDA_NUTRIENT_NUMBERS.carbs),
      fatG: nutrient(USDA_NUTRIENT_NUMBERS.fat),
    };
  });
}

async function searchOpenFoodFacts(query: string, maxResults: number): Promise<FoodSearchResult[]> {
  const url = new URL(OFF_SEARCH_URL);
  url.searchParams.set('search_terms', query);
  url.searchParams.set('search_simple', '1');
  url.searchParams.set('json', '1');
  url.searchParams.set('page_size', String(Math.min(25, Math.max(1, maxResults))));
  url.searchParams.set('countries', 'United States');

  const response = await fetch(url.toString(), {
    headers: { 'User-Agent': OFF_USER_AGENT },
    cache: 'no-store',
  });
  if (!response.ok) {
    console.error('[food-db] Open Food Facts search failed:', response.status);
    return [];
  }
  const payload = (await response.json()) as {
    products?: Array<{
      code?: string;
      product_name?: string;
      brands?: string;
      serving_size?: string;
      nutriments?: Record<string, number>;
    }>;
  };

  return (payload.products ?? [])
    .filter((product) => product.product_name && product.code)
    .map((product) => {
      const n = product.nutriments ?? {};
      // Prefer per-serving values when present; fall back to per-100g (most
      // Open Food Facts entries only have per-100g data populated).
      const pick = (base: string) => (n[`${base}_serving`] ?? n[`${base}_100g`] ?? n[base] ?? null);
      return {
        source: 'openfoodfacts' as const,
        externalId: `off:${product.code}`,
        foodName: String(product.product_name),
        brandName: product.brands ? product.brands.split(',')[0].trim() : null,
        servingDescription: product.serving_size || 'per 100g',
        calories: pick('energy-kcal'),
        proteinG: pick('proteins'),
        carbsG: pick('carbohydrates'),
        fatG: pick('fat'),
      };
    });
}

export async function searchFoods(query: string, maxResults = 20): Promise<FoodSearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const half = Math.ceil(maxResults / 2);
  const [usdaResults, offResults] = await Promise.all([
    searchUsda(trimmed, half).catch(() => []),
    searchOpenFoodFacts(trimmed, half).catch(() => []),
  ]);

  // Interleave so neither source dominates the top of the list.
  const combined: FoodSearchResult[] = [];
  const max = Math.max(usdaResults.length, offResults.length);
  for (let i = 0; i < max; i += 1) {
    if (usdaResults[i]) combined.push(usdaResults[i]);
    if (offResults[i]) combined.push(offResults[i]);
  }
  return combined.slice(0, maxResults);
}

export function foodDatabaseConfigured(): boolean {
  return usdaConfigured();
}
