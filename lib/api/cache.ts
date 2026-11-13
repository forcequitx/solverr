/** For public lists that change about once a minute: browsers keep them 60 s and Vercel's CDN serves one copy to every visitor for 60 s,
    then the previous copy for up to 60 s more while it fetches a fresh one. Browsers do not read CDN-Cache-Control. */
export const MINUTE_CACHE_HEADERS = { "Cache-Control": "public, max-age=60", "CDN-Cache-Control": "public, s-maxage=60, stale-while-revalidate=60" };
