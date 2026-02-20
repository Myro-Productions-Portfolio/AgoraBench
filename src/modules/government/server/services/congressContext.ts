// src/server/services/congressContext.ts

const CONGRESS_API_BASE = 'https://api.congress.gov/v3';
const CURRENT_CONGRESS = 119;
const MAX_BILLS = 5;
const MAX_CHARS = 800;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

const TOPIC_KEYWORDS = [
  'artificial intelligence',
  ' ai ',
  'automation',
  'technology',
  'digital',
  'workforce',
  'labor',
  'data privacy',
  'cybersecurity',
  'fiscal',
];

interface CongressBill {
  number: string;
  type: string;
  title: string;
  latestAction: {
    text: string;
    actionDate: string;
  };
  updateDate: string;
}

interface CongressBillsResponse {
  bills: CongressBill[];
}

interface SummaryItem {
  text: string;
  updateDate: string;
}

interface SummariesResponse {
  summaries: SummaryItem[];
}

let cache: { block: string; ts: number } | null = null;

export async function buildCongressContextBlock(): Promise<string> {
  if (cache && Date.now() - cache.ts < CACHE_TTL_MS) return cache.block;

  const apiKey = process.env['CONGRESS_API_KEY'];
  if (!apiKey) {
    console.warn('[congressContext] CONGRESS_API_KEY not set — skipping');
    return '';
  }

  try {
    const block = await fetchCongressBlock(apiKey);
    cache = { block, ts: Date.now() };
    return block;
  } catch (err) {
    console.warn('[congressContext] fetch failed:', err instanceof Error ? err.message : String(err));
    return '';
  }
}

async function fetchCongressBlock(apiKey: string): Promise<string> {
  const fromDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10) + 'T00:00:00Z';

  const listUrl = new URL(`${CONGRESS_API_BASE}/bill`);
  listUrl.searchParams.set('format', 'json');
  listUrl.searchParams.set('limit', '50');
  listUrl.searchParams.set('fromDateTime', fromDate);
  listUrl.searchParams.set('congress', String(CURRENT_CONGRESS));
  listUrl.searchParams.set('api_key', apiKey);
  // Append sort manually — URLSearchParams encodes '+' as '%2B' which breaks the API param
  const listFetchUrl = listUrl.toString() + '&sort=updateDate+desc';

  const listRes = await fetch(listFetchUrl);
  if (!listRes.ok) return '';

  const listData = await listRes.json() as CongressBillsResponse;
  const bills = listData.bills ?? [];

  const matched = bills.filter((b) => {
    const lower = b.title.toLowerCase();
    return TOPIC_KEYWORDS.some((kw) => lower.includes(kw));
  }).slice(0, MAX_BILLS);

  if (matched.length === 0) return '';

  const lines = (await Promise.all(matched.map(async (bill) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const summary = await fetchSummary(apiKey, CURRENT_CONGRESS, bill.type, bill.number, controller.signal)
      .finally(() => clearTimeout(timer));
    const desc = summary ?? bill.latestAction?.text ?? '';
    const truncDesc = firstSentence(desc, 200);
    if (!truncDesc) return null;
    return `[${bill.type}.${bill.number}] ${bill.title}:\n  ${truncDesc}`;
  }))).filter((l): l is string => l !== null);

  if (lines.length === 0) return '';
  const block = lines.join('\n\n');
  return block.slice(0, MAX_CHARS);
}

async function fetchSummary(apiKey: string, congress: number, type: string, number: string, signal?: AbortSignal): Promise<string | null> {
  try {
    const url = new URL(`${CONGRESS_API_BASE}/bill/${congress}/${type.toLowerCase()}/${number}/summaries`);
    url.searchParams.set('format', 'json');
    url.searchParams.set('api_key', apiKey);

    const res = await fetch(url.toString(), { signal });
    if (!res.ok) return null;

    const data = await res.json() as SummariesResponse;
    const summaries = data.summaries ?? [];
    if (summaries.length === 0) return null;

    const latest = summaries.sort((a, b) =>
      new Date(b.updateDate).getTime() - new Date(a.updateDate).getTime()
    )[0];

    return latest?.text ? stripHtml(latest.text) : null;
  } catch {
    return null;
  }
}

function firstSentence(text: string, maxChars: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  const end = clean.search(/[.!?]/);
  const sentence = end !== -1 ? clean.slice(0, end + 1) : clean;
  return sentence.slice(0, maxChars);
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, '').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim();
}
