"use client";

import dynamic from "next/dynamic";

/** The API reference renderer and its code highlighter as a separate download that only API pages load; still rendered on the server. A
    client component is needed here: `next/dynamic` in a server page does not split the code off from the route's other pages. */
export const OpenAPIPage = dynamic(() => import("@/components/docs/api-page").then((mod) => mod.OpenAPIPage));
