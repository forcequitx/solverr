import localFont from "next/font/local";

/** Self-hosted (SIL OFL, see the OFL files) so pages never depend on reaching Google Fonts; Latin and Latin Extended,
    with DM Sans fixed at optical size 14 as Google Fonts serves it. */
const dmSans = localFont({ src: "./DMSans-Variable.woff2", weight: "100 1000", variable: "--font-dm-sans", display: "swap" });
const figtree = localFont({ src: "./Figtree-Variable.woff2", weight: "300 900", variable: "--font-figtree", display: "swap" });

/** CSS variables for the two app fonts, set on <html> by the root layout and the global error page. */
export const FONT_VARIABLES = `${dmSans.variable} ${figtree.variable}`;
