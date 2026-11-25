import type { MetadataRoute } from "next";

/** Install metadata: name and icons when MissionHQ is added to a home screen. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "MissionHQ",
    short_name: "MissionHQ",
    description: "Real-time office attendance tracking & compliance analytics",
    start_url: "/",
    display: "standalone",
    background_color: "#000000",
    theme_color: "#000000",
    icons: [
      { src: "/brand/missionhq-mark-192.png", sizes: "192x192", type: "image/png" },
      { src: "/brand/missionhq-mark-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
