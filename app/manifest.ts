import type { MetadataRoute } from "next";

/** Web app manifest. Colors repeat the `--bg` and `--accent` tokens in globals.css, which a manifest cannot read. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Solverr",
    short_name: "Solverr",
    description: "Crypto checkout on NEAR Intents. Customers and AI agents pay with the coin they hold, and you receive the coin you choose in your own wallet.",
    start_url: "/",
    display: "browser",
    background_color: "#ffffff",
    theme_color: "#155dfc",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
