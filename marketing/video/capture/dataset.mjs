// Demo dataset shown in the marketing video. Plain CardSpoke store JSON.
const T0 = Date.UTC(2026, 8, 1);
let n = 0;
const cards = {};
const rootOrder = [];

function card(title, body, tags = [], parent = null) {
  const id = `demo${++n}`;
  cards[id] = {
    id, title, body, parentId: parent, children: [], tags, kind: 'note', modsData: {},
    createdAt: T0 + n * 3600e3, updatedAt: T0 + n * 5400e3
  };
  if (parent) cards[parent].children.push(id); else rootOrder.push(id);
  return id;
}

const novel = card('Novel: The Lighthouse Keeper',
  'A novel in three acts about a keeper who logs every ship that never arrives.\n\nStart with [[Characters]], then the [[Plot Outline]].',
  ['writing', 'novel']);
const chars = card('Characters', 'Who lives on the island, and who keeps leaving it.', ['writing'], novel);
card('Mara Quinn', 'The keeper. Precise, stubborn, writes everything down.\n\nAppears in [[Act I]] and [[Act III]].', ['character'], chars);
card('Elias Thorne', 'A cartographer who maps coastlines that keep moving.', ['character'], chars);
card('The Harbourmaster', 'Knows more than he says about the missing ships.', ['character'], chars);
const plot = card('Plot Outline', 'Three acts, one storm.', ['writing', 'structure'], novel);
card('Act I', '**The log.** Mara notices a ship that appears in the log but never in the harbour.', ['structure'], plot);
card('Act II', '**The map.** Elias arrives with a chart of an island that should not exist.', ['structure'], plot);
card('Act III', '**The storm.** Every missing ship comes home at once.', ['structure'], plot);
card('World & Setting', 'A tidal island off the north coast. Fog most mornings. One road.', ['worldbuilding'], novel);
card('Research', 'Lighthouse logbooks, 1880-1920. Fresnel lenses. Tide tables.', ['research'], novel);

const launch = card('Product Launch Q4',
  'Ship v2 by November 14. Owners in [[Launch Checklist]].',
  ['work', 'priority']);
card('Roadmap', 'Beta Oct 6 · Pricing Oct 20 · Launch Nov 14', ['work', 'planning'], launch);
card('Launch Checklist', '- [x] Landing page\n- [x] Press kit\n- [ ] Pricing page\n- [ ] Launch email', ['work'], launch);
card('Meeting Notes', 'Oct 2: agreed on the freemium tier. See [[Roadmap]].', ['work', 'meetings'], launch);
card('Competitor Notes', 'Everyone has sync. Nobody is local-first.', ['work', 'research'], launch);

const kyoto = card('Kyoto Trip', 'Ten days in April. Cherry blossoms, temples, ramen.', ['travel']);
card('Itinerary', 'Day 1 Fushimi Inari at dawn · Day 2 Arashiyama · Day 3 Nishiki Market', ['travel', 'planning'], kyoto);
card('Food to Try', 'Yudofu · Matcha everything · Kaiseki once · Nishiki tamagoyaki', ['travel', 'food'], kyoto);
card('Packing List', 'Walking shoes, rail pass, a very small notebook.', ['travel'], kyoto);

const reading = card('Reading List', 'Currently: The Overstory. Next: Piranesi.', ['books']);
card('The Overstory', 'Trees as characters. Notes on structure for [[Plot Outline]].', ['books', 'research'], reading);
card('Piranesi', 'An endless house of tides and statues.', ['books'], reading);
card('How to Take Smart Notes', 'One idea per card. Link everything.', ['books', 'method'], reading);

const recipes = card('Recipes', 'Weeknight dinners and one ambitious cake.', ['cooking']);
card('Miso Ramen', 'Broth 6 h · tare · ajitama eggs. Tried in [[Kyoto Trip]].', ['cooking', 'food'], recipes);
card('Lemon Olive Oil Cake', 'Moist, bright, forgiving.', ['cooking', 'baking'], recipes);

const ideas = card('Ideas Inbox', 'Capture first. Sort later.', ['inbox']);
card('Podcast about maps', 'Interview cartographers. Ask Elias? (He is fictional.)', ['idea'], ideas);
card('Tide-clock widget', 'A clock that shows high tide instead of noon.', ['idea'], ideas);

const garden = card('Garden Journal', 'Tomatoes in the south bed, herbs by the door.', ['garden']);
card('Spring Planting', 'Basil, thyme, three kinds of tomato.', ['garden', 'planning'], garden);

card('Learning Japanese', 'Twenty minutes a day. Kana done, kanji next.', ['learning', 'travel']);

export const store = {
  rootOrder, cards, plugins: {}, bookmarks: [launch, novel], recentCards: [novel, launch, kyoto],
  viewMode: 'normal', activeTheme: 'light', richTextEnabled: true,
  metadata: { name: 'My Brain', storageType: 'localstorage', storageConfig: {}, createdAt: T0 }
};
export const ids = { novel, chars, plot, launch, kyoto, reading, recipes, ideas };
