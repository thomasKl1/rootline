// Tests de la fonction, sans réseau : Pl@ntNet et Open Plantbook sont simulés.
// Lancer : deno test -A supabase/functions/identify-plant/index.test.ts

function assertEquals(a: unknown, b: unknown) {
  const x = JSON.stringify(a), y = JSON.stringify(b)
  if (x !== y) throw new Error(`attendu ${y}, reçu ${x}`)
}
import { intervalsFromMoisture, pickPlantbookMatch, searchPlan, synonymsOf } from "./care.ts";

// Base Open Plantbook simulée : quelques espèces, sous leur nom « historique ».
const OPB: Record<string, number> = {
  'monstera deliciosa': 15,
  "monstera deliciosa 'variegata'": 15,
  'calathea roseopicta': 35,
  'calathea ornata': 30,
  'sansevieria trifasciata': 10,
};
const PLANTNET: Record<string, unknown[]> = {
  monstera: [
    { score: 0.91, species: { scientificNameWithoutAuthor: 'Monstera deliciosa', commonNames: ['Faux philodendron'], genus: { scientificNameWithoutAuthor: 'Monstera' }, family: { scientificNameWithoutAuthor: 'Araceae' } } },
    { score: 0.03, species: { scientificNameWithoutAuthor: 'Plantus inconnus', commonNames: ['philodendron'], genus: { scientificNameWithoutAuthor: 'Plantus' } } },
  ],
  calathea: [
    { score: 0.8, species: { scientificNameWithoutAuthor: 'Goeppertia roseopicta', commonNames: ['Calathéa'], genus: { scientificNameWithoutAuthor: 'Goeppertia' } } },
    { score: 0.1, species: { scientificNameWithoutAuthor: 'Goeppertia majestica', commonNames: [], genus: { scientificNameWithoutAuthor: 'Goeppertia' } } },
  ],
};

let handler: (r: Request) => Promise<Response>;
(Deno as any).serve = (h: any) => { handler = h; };
Deno.env.set('PLANTNET_API_KEY', 'k'); Deno.env.set('OPENPLANTBOOK_CLIENT_ID', 'id'); Deno.env.set('OPENPLANTBOOK_CLIENT_SECRET', 's');
let photo = 'monstera';
const searches: string[] = [];
globalThis.fetch = async (input: any, init?: any) => {
  const url = String(input);
  if (url.includes('plantnet')) return Response.json({ results: PLANTNET[photo], remainingIdentificationRequests: 497 });
  if (url.endsWith('/token/')) return Response.json({ access_token: 'tok', expires_in: 3600 });
  if (url.includes('/plant/search')) {
    const q = decodeURIComponent(url.split('alias=')[1]).toLowerCase();
    searches.push(q);
    // Comme la vraie API : recherche par sous-chaîne sur le nom ; « philodendron » ramène une monstera.
    const hits = Object.keys(OPB).filter((pid) => pid.includes(q) || (q === 'philodendron' && pid.startsWith('monstera')));
    return Response.json({ results: hits.map((pid) => ({ pid })) });
  }
  if (url.includes('/plant/detail/')) {
    const pid = decodeURIComponent(url.split('/detail/')[1].replace(/\/$/, ''));
    return Response.json({ pid, min_soil_moist: OPB[pid], max_soil_moist: 60 });
  }
  return new Response('nope', { status: 500 });
};
await import("./index.ts");

const post = async (body: unknown) => (await handler(new Request('http://x', { method: 'POST', body: JSON.stringify(body) }))).json();

Deno.test('espèce trouvée sous son nom exact', async () => {
  photo = 'monstera';
  const body = await post({ image: btoa('jpeg') });
  const [m, other] = body.candidates;
  assertEquals([m.care.plantbook_pid, m.care.match, m.care.interval_summer_days], ['monstera deliciosa', 'species', 14]);
  // Le nom courant « philodendron » ramène une monstera : refusé, ce n'est pas le même genre.
  assertEquals([other.care.source, other.care.match], ['default', null]);
  assertEquals('genus' in m || 'commonNames' in m, false);
});

Deno.test('calathea renommée Goeppertia : retrouvée par son ancien nom', async () => {
  photo = 'calathea';
  const body = await post({ image: btoa('jpeg') });
  const [rose, majestica] = body.candidates;
  assertEquals([rose.care.plantbook_pid, rose.care.match, rose.care.interval_summer_days], ['calathea roseopicta', 'synonym', 4]);
  // Espèce absente : une autre calathea, signalée comme approximative.
  assertEquals([majestica.care.match, majestica.care.source], ['genus', 'openplantbook']);
});

Deno.test('recalcul pour une espèce déjà enregistrée', async () => {
  const body = await post({ species: 'Goeppertia roseopicta', commonName: null });
  assertEquals(body.candidates[0].care.plantbook_pid, 'calathea roseopicta');
});

Deno.test('requêtes invalides', async () => {
  assertEquals((await handler(new Request('http://x', { method: 'POST', body: '{}' }))).status, 400);
  assertEquals((await handler(new Request('http://x', { method: 'OPTIONS' }))).status, 200);
});

Deno.test('logique pure', () => {
  assertEquals(synonymsOf('Dracaena trifasciata'), ['sansevieria trifasciata']);
  assertEquals(synonymsOf('Dracaena marginata'), []);
  assertEquals(searchPlan('Goeppertia roseopicta', 'Goeppertia', ['Calathéa']).map((s) => s.kind + ':' + s.term), [
    'species:Goeppertia roseopicta', 'synonym:calathea roseopicta', 'common:Calathéa', 'genus:goeppertia', 'genus:calathea',
  ]);
  assertEquals(intervalsFromMoisture(null), { summer: 7, winter: 14 });
  assertEquals(pickPlantbookMatch('Ficus lyrata', [{ pid: 'ficus elastica' }]), null);
});
